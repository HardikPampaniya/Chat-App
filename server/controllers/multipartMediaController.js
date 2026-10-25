const crypto = require("crypto");
const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const MediaUpload = require("../models/MediaUpload");
const Message = require("../models/Message");
const { isParticipant } = require("./conversationController");
const {
    createMultipartMediaUpload,
    uploadMediaPart,
    completeMultipartMediaUpload,
    abortMultipartMediaUpload,
    getMediaMetadata,
    getMedia: getStoredMedia,
    deleteMedia
} = require("../services/objectStorage");
const {
    getMediaDefinition,
    hasValidSignature,
    sanitizeOriginalName,
    MAX_MEDIA_SIZE_BYTES,
    MEDIA_PART_SIZE_BYTES
} = require("../utils/mediaTypes");

const roomFor = id => `conversation:${id}`;
const idString = value => {
    const id = value && typeof value === "object" && value._id ? value._id : value;
    return id == null ? "" : id.toString();
};
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

const findConversationForUser = async (conversationId, userId) => {
    if (!mongoose.isValidObjectId(conversationId)) throw fail("Invalid conversation ID");
    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !isParticipant(conversation, userId)) throw fail("Access denied", 403);
    return conversation;
};

const findUpload = async (req, uploadId) => {
    const upload = await MediaUpload.findOne({
        uploadId,
        conversation: req.params.conversationId,
        sender: req.user._id,
        expiresAt: { $gt: new Date() }
    });
    if (!upload) throw fail("Upload session not found or expired", 404);
    return upload;
};

const initiateMultipartUpload = async (req, res) => {
    const conversation = await findConversationForUser(req.params.conversationId, req.user._id);
    const originalName = String(req.body?.fileName || "");
    const mimeType = String(req.body?.mimeType || "").toLowerCase();
    const size = Number(req.body?.size);
    const clientMessageId = String(req.body?.clientMessageId || "").slice(0, 100);

    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_MEDIA_SIZE_BYTES) {
        throw fail("Files must be 2 GB or smaller");
    }
    const definition = getMediaDefinition({ originalname: originalName, mimetype: mimeType });
    if (!definition) throw fail("Choose a supported image, video, audio, PDF, DOC or DOCX file", 415);

    if (clientMessageId) {
        const existing = await Message.findOne({
            conversation: conversation._id,
            sender: req.user._id,
            clientMessageId
        });
        if (existing) {
            await existing.populate("sender", "username");
            await existing.populate("receiver", "username");
            return res.status(200).json({ message: existing });
        }

        const activeUpload = await MediaUpload.findOne({
            conversation: conversation._id,
            sender: req.user._id,
            clientMessageId,
            expiresAt: { $gt: new Date() }
        });
        if (activeUpload) {
            return res.status(200).json({ uploadId: activeUpload.uploadId, partSize: MEDIA_PART_SIZE_BYTES });
        }
    }

    const receiver = conversation.participants.find(id => idString(id) !== idString(req.user._id));
    const storageKey = `${conversation._id}/${crypto.randomUUID()}`;
    const filename = `${crypto.randomUUID()}${definition.extension}`;
    const uploadId = await createMultipartMediaUpload({
        key: storageKey,
        contentType: definition.mimeType,
        metadata: {
            conversationid: conversation._id.toString(),
            senderid: req.user._id.toString()
        }
    });

    try {
        await MediaUpload.create({
            uploadId,
            storageKey,
            conversation: conversation._id,
            sender: req.user._id,
            receiver,
            clientMessageId: clientMessageId || undefined,
            originalName: sanitizeOriginalName(originalName),
            filename,
            mimeType: definition.mimeType,
            type: definition.type,
            size,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        });
    } catch (error) {
        await abortMultipartMediaUpload({ key: storageKey, uploadId }).catch(() => {});
        if (error.code === 11000 && clientMessageId) {
            const activeUpload = await MediaUpload.findOne({
                conversation: conversation._id,
                sender: req.user._id,
                clientMessageId,
                expiresAt: { $gt: new Date() }
            });
            if (activeUpload) {
                return res.status(200).json({ uploadId: activeUpload.uploadId, partSize: MEDIA_PART_SIZE_BYTES });
            }
        }
        throw error;
    }

    res.status(201).json({ uploadId, partSize: MEDIA_PART_SIZE_BYTES });
};

const uploadMultipartPart = async (req, res) => {
    const upload = await findUpload(req, req.params.uploadId);
    const partNumber = Number(req.params.partNumber);
    const totalParts = Math.ceil(upload.size / MEDIA_PART_SIZE_BYTES);
    if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > totalParts) {
        throw fail("Invalid upload part number");
    }
    if (!Buffer.isBuffer(req.body)) throw fail("Upload part is empty");

    const expectedSize = partNumber === totalParts
        ? upload.size - MEDIA_PART_SIZE_BYTES * (totalParts - 1)
        : MEDIA_PART_SIZE_BYTES;
    if (req.body.length !== expectedSize) throw fail("Upload part size is invalid");

    if (partNumber === 1) {
        const definition = getMediaDefinition({ originalname: upload.originalName, mimetype: upload.mimeType });
        if (!definition || !hasValidSignature(req.body, definition)) {
            await abortMultipartMediaUpload({ key: upload.storageKey, uploadId: upload.uploadId }).catch(() => {});
            await MediaUpload.deleteOne({ _id: upload._id });
            throw fail("The file contents do not match a supported file type", 415);
        }
    }

    const etag = await uploadMediaPart({
        key: upload.storageKey,
        uploadId: upload.uploadId,
        partNumber,
        body: req.body
    });
    await MediaUpload.updateOne(
        { _id: upload._id },
        { $pull: { parts: { partNumber } } }
    );
    await MediaUpload.updateOne(
        { _id: upload._id },
        { $push: { parts: { partNumber, etag } } }
    );
    res.json({ partNumber });
};

const readStreamPrefix = async (stream, limit = 8192) => {
    const buffers = [];
    let length = 0;
    for await (const chunk of stream) {
        const remaining = limit - length;
        if (remaining <= 0) break;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const slice = buffer.subarray(0, remaining);
        buffers.push(slice);
        length += slice.length;
    }
    return Buffer.concat(buffers, length);
};

const finishMultipartUpload = async (req, res) => {
    const upload = await MediaUpload.findOne({
        uploadId: req.params.uploadId,
        conversation: req.params.conversationId,
        sender: req.user._id
    });
    if (!upload) {
        const clientMessageId = String(req.body?.clientMessageId || "").slice(0, 100);
        const existing = clientMessageId
            ? await Message.findOne({
                conversation: req.params.conversationId,
                sender: req.user._id,
                clientMessageId
            }).populate("sender", "username").populate("receiver", "username")
            : null;
        if (existing) return res.status(200).json({ message: existing });
        throw fail("Upload session not found or expired", 404);
    }
    if (upload.expiresAt <= new Date()) throw fail("Upload session expired", 410);

    const totalParts = Math.ceil(upload.size / MEDIA_PART_SIZE_BYTES);
    const parts = upload.parts
        .slice()
        .sort((a, b) => a.partNumber - b.partNumber);
    if (parts.length !== totalParts || parts.some((part, index) => part.partNumber !== index + 1 || !part.etag)) {
        throw fail("Some upload parts are missing. Retry the upload.", 409);
    }

    const conversation = await findConversationForUser(req.params.conversationId, req.user._id);
    let message;
    let objectCompleted = false;
    let messageCommitted = false;
    try {
        const completed = await completeMultipartMediaUpload({
            key: upload.storageKey,
            uploadId: upload.uploadId,
            parts
        });
        objectCompleted = true;

        const metadata = await getMediaMetadata(upload.storageKey);
        if (metadata.ContentLength !== upload.size ||
            metadata.Metadata?.conversationid !== conversation._id.toString() ||
            metadata.Metadata?.senderid !== req.user._id.toString()) {
            await deleteMedia(upload.storageKey).catch(() => {});
            await MediaUpload.deleteOne({ _id: upload._id });
            throw fail("Uploaded file verification failed", 400);
        }

        const definition = getMediaDefinition({ originalname: upload.originalName, mimetype: upload.mimeType });
        const prefix = await getStoredMedia(upload.storageKey, "bytes=0-8191");
        const signature = await readStreamPrefix(prefix.Body);
        if (!definition || !hasValidSignature(signature, definition)) {
            await deleteMedia(upload.storageKey).catch(() => {});
            await MediaUpload.deleteOne({ _id: upload._id });
            throw fail("The file contents do not match a supported file type", 415);
        }

        if (upload.clientMessageId) {
            const existing = await Message.findOne({
                conversation: conversation._id,
                sender: req.user._id,
                clientMessageId: upload.clientMessageId
            });
            if (existing) {
                await deleteMedia(upload.storageKey).catch(() => {});
                await MediaUpload.deleteOne({ _id: upload._id });
                await existing.populate("sender", "username");
                await existing.populate("receiver", "username");
                return res.status(200).json({ message: existing });
            }
        }

        const previousLastMessage = conversation.lastMessage;
        try {
            message = await Message.create({
                conversation: conversation._id,
                sender: upload.sender,
                receiver: upload.receiver,
                type: upload.type,
                clientMessageId: upload.clientMessageId || undefined,
                media: {
                    filename: upload.filename,
                    storageKey: upload.storageKey,
                    originalName: upload.originalName,
                    mimeType: upload.mimeType,
                    size: upload.size,
                    etag: completed.ETag || metadata.ETag
                }
            });
            conversation.lastMessage = message._id;
            await conversation.save();
            messageCommitted = true;
        } catch (error) {
            if (message?._id) await Message.deleteOne({ _id: message._id }).catch(() => {});
            if (message?._id) {
                conversation.lastMessage = previousLastMessage;
                await conversation.save().catch(() => {});
            }
            throw error;
        }

        await MediaUpload.deleteOne({ _id: upload._id }).catch(() => {});
        await message.populate("sender", "username");
        await message.populate("receiver", "username");
        req.app.get("io").to(roomFor(conversation._id))
            .to(`user:${upload.sender}`)
            .to(`user:${upload.receiver}`)
            .emit("new_message", message);
        return res.status(201).json({ message });
    } catch (error) {
        if (objectCompleted && !messageCommitted) {
            await deleteMedia(upload.storageKey).catch(() => {});
            await MediaUpload.deleteOne({ _id: upload._id }).catch(() => {});
        }
        if (error.code === 11000 && upload.clientMessageId) {
            const existing = await Message.findOne({
                conversation: conversation._id,
                sender: req.user._id,
                clientMessageId: upload.clientMessageId
            }).populate("sender", "username").populate("receiver", "username");
            if (existing) {
                await MediaUpload.deleteOne({ _id: upload._id }).catch(() => {});
                return res.status(200).json({ message: existing });
            }
        }
        throw error;
    }
};

const cancelMultipartUpload = async (req, res) => {
    const upload = await MediaUpload.findOne({
        uploadId: req.params.uploadId,
        conversation: req.params.conversationId,
        sender: req.user._id
    });
    if (upload) {
        await abortMultipartMediaUpload({ key: upload.storageKey, uploadId: upload.uploadId });
        await MediaUpload.deleteOne({ _id: upload._id });
    }
    res.status(204).end();
};

module.exports = {
    initiateMultipartUpload,
    uploadMultipartPart,
    finishMultipartUpload,
    cancelMultipartUpload
};

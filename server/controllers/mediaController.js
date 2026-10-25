const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const crypto = require("crypto");
const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const { isParticipant } = require("./conversationController");
const { getMedia: getStoredMedia, putMedia, deleteMedia } = require("../services/objectStorage");
const { getMediaDefinition, hasValidSignature, sanitizeOriginalName } = require("../utils/mediaTypes");

const roomFor = id => `conversation:${id}`;

const sendMedia = async (req, res) => {
    const conversationId = req.params.conversationId;
    if (!mongoose.isValidObjectId(conversationId)) {
        return res.status(400).json({ message: "Invalid conversation ID" });
    }
    if (!req.file) return res.status(400).json({ message: "Choose a file to attach" });

    const definition = getMediaDefinition(req.file);
    if (!definition || !hasValidSignature(req.file.buffer, definition)) {
        return res.status(415).json({ message: "The file contents do not match a supported file type" });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !isParticipant(conversation, req.user._id)) {
        return res.status(403).json({ message: "Access denied" });
    }

    const receiver = conversation.participants.find(
        id => id.toString() !== req.user._id.toString()
    );
    const clientMessageId = String(req.body?.clientMessageId || "").slice(0, 100);
    if (clientMessageId) {
        const existing = await Message.findOne({ conversation: conversation._id, sender: req.user._id, clientMessageId });
        if (existing) {
            await existing.populate("sender", "username");
            await existing.populate("receiver", "username");
            return res.status(200).json({ message: existing });
        }
    }
    const storageKey = `${conversation._id}/${crypto.randomUUID()}`;
    const originalName = sanitizeOriginalName(req.file.originalname);
    const filename = `${crypto.randomUUID()}${definition.extension}`;
    let stored = false;
    let message;

    const previousLastMessage = conversation.lastMessage;
    try {
        const etag = await putMedia({
            key: storageKey,
            body: req.file.buffer,
            contentType: definition.mimeType,
            metadata: {
                conversationid: conversation._id.toString(),
                senderid: req.user._id.toString()
            }
        });
        stored = true;

        message = await Message.create({
            conversation: conversation._id,
            sender: req.user._id,
            receiver,
            type: definition.type,
            clientMessageId: clientMessageId || undefined,
            media: {
                filename,
                storageKey,
                originalName,
                mimeType: definition.mimeType,
                size: req.file.size,
                etag
            }
        });

        conversation.lastMessage = message._id;
        await conversation.save();
    } catch (error) {
        if (message?._id) await Message.deleteOne({ _id: message._id }).catch(() => {});
        if (message?._id) {
            conversation.lastMessage = previousLastMessage;
            await conversation.save().catch(() => {});
        }
        if (stored) await deleteMedia(storageKey).catch(() => {});
        if (error.code === 11000 && clientMessageId) {
            const existing = await Message.findOne({ conversation: conversation._id, sender: req.user._id, clientMessageId });
            if (existing) {
                await existing.populate("sender", "username");
                await existing.populate("receiver", "username");
                return res.status(200).json({ message: existing });
            }
        }
        throw error;
    }

    await message.populate("sender", "username");
    await message.populate("receiver", "username");
    req.app.get("io").to(roomFor(conversationId))
        .to(`user:${req.user._id}`)
        .to(`user:${receiver}`)
        .emit("new_message", message);
    res.status(201).json({ message });
};

const getMedia = async (req, res) => {
    const identifier = req.params.filename;
    let message = mongoose.isValidObjectId(identifier)
        ? await Message.findById(identifier)
        : null;
    if (!message) message = await Message.findOne({ "media.filename": identifier });
    if (!message?.media) return res.status(404).send("File not found");

    const conversation = await Conversation.findById(message.conversation);
    if (!conversation || !isParticipant(conversation, req.user._id)) {
        return res.status(403).send("Access denied");
    }

    const isDocument = message.type === "document";
    const disposition = isDocument ? "attachment" : "inline";
    const safeName = encodeURIComponent(message.media.originalName || "attachment").replace(/['()]/g, escape);

    res.set({
        "Content-Type": message.media.mimeType || "application/octet-stream",
        "Content-Disposition": `${disposition}; filename*=UTF-8''${safeName}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store"
    });
    if (message.media.size) res.set("Content-Length", String(message.media.size));

    if (message.media.storageKey) {
        const object = await getStoredMedia(message.media.storageKey);
        if (object.ContentLength) res.set("Content-Length", String(object.ContentLength));
        await pipeline(object.Body, res);
        return;
    }

    // Backward compatibility for older local-disk uploads, if the original file still exists.
    const legacyName = path.basename(message.media.filename || "");
    const legacyRoot = path.resolve(process.cwd(), "uploads");
    const legacyPath = path.resolve(legacyRoot, legacyName);
    if (!legacyName || path.dirname(legacyPath) !== legacyRoot || !fs.existsSync(legacyPath)) {
        return res.status(410).send("This legacy attachment is no longer available");
    }
    await pipeline(fs.createReadStream(legacyPath), res);
};

module.exports = { sendMedia, getMedia };

const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const crypto = require("crypto");
const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const { isParticipant } = require("./conversationController");
const { getMedia: getStoredMedia, getMediaMetadata, putMedia, deleteMedia } = require("../services/objectStorage");
const { getMediaDefinition, hasValidSignature, sanitizeOriginalName } = require("../utils/mediaTypes");

const roomFor = id => `conversation:${id}`;

const parseByteRange = (header, size) => {
    if (!header || !header.startsWith("bytes=")) return null;
    const value = header.slice(6).trim();
    if (value.includes(",")) return { unsatisfiable: true };

    const match = /^(\d*)-(\d*)$/.exec(value);
    if (!match || (!match[1] && !match[2])) return null;

    let start;
    let end;
    if (!match[1]) {
        const suffixLength = Number(match[2]);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { unsatisfiable: true };
        start = Math.max(0, size - suffixLength);
        end = size - 1;
    } else {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) {
            return { unsatisfiable: true };
        }
        end = Math.min(end, size - 1);
    }
    return { start, end };
};

const setMediaHeaders = (res, message) => {
    const isDocument = message.type === "document";
    const safeName = encodeURIComponent(message.media.originalName || "attachment").replace(/['()]/g, escape);
    res.set({
        "Content-Type": message.media.mimeType || "application/octet-stream",
        "Content-Disposition": `${isDocument ? "attachment" : "inline"}; filename*=UTF-8''${safeName}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Accept-Ranges": "bytes"
    });
};

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

    if (message.media.storageKey) {
        const metadata = await getMediaMetadata(message.media.storageKey);
        const size = Number(metadata.ContentLength ?? message.media.size);
        const range = parseByteRange(req.headers.range, size);
        setMediaHeaders(res, message);
        if (range?.unsatisfiable) {
            res.set("Content-Range", `bytes */${size}`);
            return res.status(416).end();
        }

        const object = await getStoredMedia(
            message.media.storageKey,
            range ? `bytes=${range.start}-${range.end}` : undefined
        );
        if (range) {
            res.status(206);
            res.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
            res.set("Content-Length", String(range.end - range.start + 1));
        } else {
            res.set("Content-Length", String(size));
        }
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
    const fileStat = await fs.promises.stat(legacyPath);
    const range = parseByteRange(req.headers.range, fileStat.size);
    setMediaHeaders(res, message);
    if (range?.unsatisfiable) {
        res.set("Content-Range", `bytes */${fileStat.size}`);
        return res.status(416).end();
    }
    if (range) {
        res.status(206);
        res.set("Content-Range", `bytes ${range.start}-${range.end}/${fileStat.size}`);
        res.set("Content-Length", String(range.end - range.start + 1));
        await pipeline(fs.createReadStream(legacyPath, { start: range.start, end: range.end }), res);
        return;
    }
    res.set("Content-Length", String(fileStat.size));
    await pipeline(fs.createReadStream(legacyPath), res);
};

module.exports = { sendMedia, getMedia };

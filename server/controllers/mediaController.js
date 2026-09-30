const fs = require("fs/promises");
const path = require("path");
const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const { isParticipant } = require("./conversationController");

const sendMedia = async (req, res) => {
    const conversationId = req.params.conversationId;

    if (!mongoose.isValidObjectId(conversationId)) {
        return res.status(400).json({ message: "Invalid conversation ID" });
    }

    if (!req.file) {
        return res.status(400).json({ message: "No image or video selected" });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !isParticipant(conversation, req.user._id)) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(403).json({ message: "Access denied" });
    }

    const receiver = conversation.participants.find(
        id => id.toString() !== req.user._id.toString()
    );

    const type = req.file.mimetype.startsWith("image/") ? "image" : "video";

    const message = await Message.create({
        conversation: conversation._id,
        sender: req.user._id,
        receiver,
        type,
        media: {
            filename: req.file.filename,
            originalName: req.file.originalname,
            mimeType: req.file.mimetype,
            size: req.file.size
        }
    });

    conversation.lastMessage = message._id;
    await conversation.save();

    await message.populate("sender", "username");
    await message.populate("receiver", "username");

    res.status(201).json({ message });
};

const getMedia = async (req, res) => {
    const message = await Message.findOne({ "media.filename": req.params.filename });

    if (!message) return res.status(404).send("File not found");

    const conversation = await Conversation.findById(message.conversation);
    if (!conversation || !isParticipant(conversation, req.user._id)) {
        return res.status(403).send("Access denied");
    }

    const filePath = path.join(process.cwd(), "uploads", message.media.filename);
    res.type(message.media.mimeType);
    res.sendFile(path.resolve(filePath));
};

module.exports = { sendMedia, getMedia };

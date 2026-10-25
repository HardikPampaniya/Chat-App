const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const { isParticipant } = require("./conversationController");

const getMessages = async (req, res) => {
    const conversationId = req.params.conversationId;

    if (!mongoose.isValidObjectId(conversationId)) {
        return res.status(400).json({ message: "Invalid conversation ID" });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
    }

    if (!isParticipant(conversation, req.user._id)) {
        return res.status(403).json({ message: "Access denied" });
    }

    const messages = await Message.find({ conversation: conversationId })
        .populate("sender", "username")
        .populate("receiver", "username")
        .sort({ createdAt: -1 })
        .limit(200);

    res.json({ messages: messages.reverse() });
};

const createTextMessage = async (req, res) => {
    const conversationId = req.params.conversationId;
    const text = String(req.body.text || "").trim();

    if (!mongoose.isValidObjectId(conversationId)) {
        return res.status(400).json({ message: "Invalid conversation ID" });
    }

    if (!text || text.length > 5000) {
        return res.status(400).json({ message: "Message must be 1 to 5000 characters" });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !isParticipant(conversation, req.user._id)) {
        return res.status(403).json({ message: "Access denied" });
    }

    const receiver = conversation.participants.find(
        id => id.toString() !== req.user._id.toString()
    );

    let message;
    const previousLastMessage = conversation.lastMessage;
    try {
        message = await Message.create({
            conversation: conversation._id,
            sender: req.user._id,
            receiver,
            type: "text",
            text
        });

        conversation.lastMessage = message._id;
        await conversation.save();
    } catch (error) {
        if (message?._id) {
            await Message.deleteOne({ _id: message._id }).catch(() => {});
            conversation.lastMessage = previousLastMessage;
            await conversation.save().catch(() => {});
        }
        throw error;
    }

    await message.populate("sender", "username");
    await message.populate("receiver", "username");

    req.app.get("io").to(`conversation:${conversationId}`)
        .to(`user:${req.user._id}`)
        .to(`user:${receiver}`)
        .emit("new_message", message);
    res.status(201).json({ message });
};

module.exports = { getMessages, createTextMessage };

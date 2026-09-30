const mongoose = require("mongoose");
const User = require("../models/User");
const Conversation = require("../models/Conversation");

const isParticipant = (conversation, userId) =>
    conversation.participants.some(id => id.toString() === userId.toString());

const findPrivateConversation = (a, b) =>
    Conversation.findOne({ participants: { $all: [a, b], $size: 2 } });

const getConversations = async (req, res) => {
    const conversations = await Conversation.find({ participants: req.user._id })
        .populate("participants", "username email lastSeen")
        .populate("lastMessage")
        .sort({ updatedAt: -1 });

    res.json({ conversations });
};

const createConversation = async (req, res) => {
    const otherUserId = req.params.userId;

    if (!mongoose.isValidObjectId(otherUserId)) {
        return res.status(400).json({ message: "Invalid user ID" });
    }

    if (otherUserId === req.user._id.toString()) {
        return res.status(400).json({ message: "You cannot chat with yourself" });
    }

    const otherUser = await User.findById(otherUserId).select("_id username email lastSeen");
    if (!otherUser) {
        return res.status(404).json({ message: "User not found" });
    }

    let conversation = await findPrivateConversation(req.user._id, otherUser._id);

    if (!conversation) {
        conversation = await Conversation.create({
            participants: [req.user._id, otherUser._id]
        });
    }

    await conversation.populate("participants", "username email lastSeen");
    res.json({ conversation });
};

const getConversation = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ message: "Invalid conversation ID" });
    }

    const conversation = await Conversation.findById(req.params.id)
        .populate("participants", "username email lastSeen");

    if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
    }

    if (!isParticipant(conversation, req.user._id)) {
        return res.status(403).json({ message: "Access denied" });
    }

    res.json({ conversation });
};

module.exports = { getConversations, createConversation, getConversation, isParticipant };

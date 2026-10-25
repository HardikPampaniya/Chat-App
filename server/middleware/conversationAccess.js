const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const { isParticipant } = require("../controllers/conversationController");

const requireConversationParticipant = async (req, res, next) => {
    const id = req.params.conversationId;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid conversation ID" });

    const conversation = await Conversation.findById(id).select("participants");
    if (!conversation || !isParticipant(conversation, req.user._id)) {
        return res.status(403).json({ message: "Access denied" });
    }
    next();
};

module.exports = requireConversationParticipant;

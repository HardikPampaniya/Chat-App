const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
    {
        participants: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
            validate: {
                validator: value => value.length === 2,
                message: "A private conversation must have exactly two users"
            },
            required: true
        },
        lastMessage: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Message",
            default: null
        }
    },
    { timestamps: true }
);

conversationSchema.index({ participants: 1 });

module.exports = mongoose.model("Conversation", conversationSchema);

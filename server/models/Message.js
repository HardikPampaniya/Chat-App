const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
    {
        conversation: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Conversation",
            required: true,
            index: true
        },
        sender: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        receiver: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        type: {
            type: String,
            enum: ["text", "image", "video"],
            default: "text"
        },
        text: {
            type: String,
            trim: true,
            maxlength: 5000,
            default: ""
        },
        media: {
            filename: String,
            originalName: String,
            mimeType: String,
            size: Number
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model("Message", messageSchema);

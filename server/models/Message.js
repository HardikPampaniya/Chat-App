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
            enum: ["text", "image", "video", "audio", "document"],
            default: "text"
        },
        clientMessageId: {
            type: String,
            maxlength: 100
        },
        text: {
            type: String,
            trim: true,
            maxlength: 5000,
            default: ""
        },
        media: {
            filename: String,
            storageKey: String,
            originalName: String,
            mimeType: String,
            size: Number,
            etag: String
        }
    },
    { timestamps: true }
);

messageSchema.index(
    { conversation: 1, sender: 1, clientMessageId: 1 },
    {
        unique: true,
        partialFilterExpression: { clientMessageId: { $type: "string" } }
    }
);
messageSchema.index({ conversation: 1, createdAt: 1 });

module.exports = mongoose.model("Message", messageSchema);

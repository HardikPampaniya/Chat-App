const mongoose = require("mongoose");

const mediaUploadPartSchema = new mongoose.Schema(
    {
        partNumber: { type: Number, required: true },
        etag: { type: String, required: true }
    },
    { _id: false }
);

const mediaUploadSchema = new mongoose.Schema(
    {
        uploadId: { type: String, required: true, unique: true },
        storageKey: { type: String, required: true, unique: true },
        conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
        sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        clientMessageId: { type: String, maxlength: 100 },
        originalName: { type: String, required: true },
        filename: { type: String, required: true },
        mimeType: { type: String, required: true },
        type: { type: String, enum: ["image", "video", "audio", "document"], required: true },
        size: { type: Number, required: true },
        parts: { type: [mediaUploadPartSchema], default: [] },
        expiresAt: { type: Date, required: true }
    },
    { timestamps: true }
);

mediaUploadSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
mediaUploadSchema.index(
    { conversation: 1, sender: 1, clientMessageId: 1 },
    {
        unique: true,
        partialFilterExpression: { clientMessageId: { $type: "string" } }
    }
);

module.exports = mongoose.model("MediaUpload", mediaUploadSchema);

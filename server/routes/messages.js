const express = require("express");
const rateLimit = require("express-rate-limit");
const { getMessages, createTextMessage } = require("../controllers/messageController");
const { sendMedia, getMedia } = require("../controllers/mediaController");
const { protect } = require("../middleware/auth");
const requireConversationParticipant = require("../middleware/conversationAccess");
const upload = require("../middleware/upload");

const router = express.Router();
const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many uploads. Try again later." }
});
router.get("/media/:filename", protect, getMedia);
router.get("/:conversationId", protect, getMessages);
router.post("/:conversationId", protect, createTextMessage);
router.post("/:conversationId/media", protect, requireConversationParticipant, uploadLimiter, upload.single("media"), sendMedia);

module.exports = router;

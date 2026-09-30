const express = require("express");
const { getMessages, createTextMessage } = require("../controllers/messageController");
const { sendMedia, getMedia } = require("../controllers/mediaController");
const { protect } = require("../middleware/auth");
const upload = require("../middleware/upload");

const router = express.Router();
router.get("/media/:filename", protect, getMedia);
router.get("/:conversationId", protect, getMessages);
router.post("/:conversationId", protect, createTextMessage);
router.post("/:conversationId/media", protect, upload.single("media"), sendMedia);

module.exports = router;

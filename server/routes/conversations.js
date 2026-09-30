const express = require("express");
const { getConversations, createConversation, getConversation } = require("../controllers/conversationController");
const { protect } = require("../middleware/auth");

const router = express.Router();
router.use(protect);
router.get("/", getConversations);
router.post("/:userId", createConversation);
router.get("/:id", getConversation);

module.exports = router;

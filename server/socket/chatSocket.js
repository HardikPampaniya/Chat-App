const jwt = require("jsonwebtoken");
const { parse } = require("cookie");
const User = require("../models/User");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");

const roomFor = conversationId => `conversation:${conversationId}`;

const authenticate = async socket => {
    const cookies = parse(socket.handshake.headers.cookie || "");
    const token = cookies.token;
    if (!token) throw new Error("Authentication required");

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.userId).select("-passwordHash");
    if (!user) throw new Error("User not found");

    return user;
};

const isParticipant = (conversation, userId) =>
    conversation.participants.some(id => id.toString() === userId.toString());

const initializeChatSocket = io => {
    io.use(async (socket, next) => {
        try {
            socket.user = await authenticate(socket);
            next();
        } catch {
            next(new Error("Authentication failed"));
        }
    });

    io.on("connection", async socket => {
        await User.findByIdAndUpdate(socket.user._id, { lastSeen: new Date() });
        socket.join(`user:${socket.user._id}`);

        socket.on("join_conversation", async conversationId => {
            const conversation = await Conversation.findById(conversationId);
            if (!conversation || !isParticipant(conversation, socket.user._id)) {
                return socket.emit("chat_error", "Access denied");
            }
            socket.join(roomFor(conversationId));
        });

        socket.on("send_message", async data => {
            try {
                const conversationId = String(data?.conversationId || "");
                const text = String(data?.text || "").trim();

                if (!text || text.length > 5000) return;

                const conversation = await Conversation.findById(conversationId);
                if (!conversation || !isParticipant(conversation, socket.user._id)) {
                    return socket.emit("chat_error", "Access denied");
                }

                const receiver = conversation.participants.find(
                    id => id.toString() !== socket.user._id.toString()
                );

                const message = await Message.create({
                    conversation: conversation._id,
                    sender: socket.user._id,
                    receiver,
                    type: "text",
                    text
                });

                conversation.lastMessage = message._id;
                await conversation.save();

                await message.populate("sender", "username");
                await message.populate("receiver", "username");

                io.to(roomFor(conversationId)).emit("new_message", message);
            } catch {
                socket.emit("chat_error", "Unable to send message");
            }
        });

        socket.on("disconnect", async () => {
            await User.findByIdAndUpdate(socket.user._id, { lastSeen: new Date() });
        });
    });
};

module.exports = initializeChatSocket;

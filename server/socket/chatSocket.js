const jwt = require("jsonwebtoken");
const { parse } = require("cookie");
const mongoose = require("mongoose");
const crypto = require("crypto");
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

const iceServers = () => {
    if (!process.env.ICE_SERVERS_JSON) {
        return [{ urls: "stun:stun.l.google.com:19302" }];
    }
    try {
        const configured = JSON.parse(process.env.ICE_SERVERS_JSON);
        if (!Array.isArray(configured) || configured.length === 0) throw new Error();
        return configured;
    } catch {
        return null;
    }
};

const initializeChatSocket = io => {
    const onlineUsers = new Map();
    const calls = new Map();
    const userCalls = new Map();

    const emitToUser = (userId, event, payload) => io.to(`user:${userId}`).emit(event, payload);

    const finishCall = (call, reason, notify = true) => {
        clearTimeout(call.timer);
        calls.delete(call.callId);
        call.users.forEach(id => {
            if (userCalls.get(id) === call.callId) userCalls.delete(id);
        });
        if (notify) {
            call.users.forEach(id => {
                if (id !== call.endedBy) emitToUser(id, "call:ended", { callId: call.callId, reason });
            });
        }
    };

    io.use(async (socket, next) => {
        try {
            const origin = socket.handshake.headers.origin;
            const configuredOrigin = process.env.CLIENT_URL || "http://localhost:3000";
            const allowedOrigin = new URL(configuredOrigin).origin;
            if (origin && origin !== allowedOrigin) throw new Error("Origin rejected");
            socket.user = await authenticate(socket);
            next();
        } catch {
            next(new Error("Authentication failed"));
        }
    });

    io.on("connection", async socket => {
        const userId = socket.user._id.toString();
        const joinedConversations = new Set();
        const eventWindows = new Map();
        const withinRateLimit = (eventName, limit, windowMs) => {
            const now = Date.now();
            let window = eventWindows.get(eventName);
            if (!window || now - window.startedAt >= windowMs) {
                window = { startedAt: now, count: 0 };
                eventWindows.set(eventName, window);
            }
            window.count += 1;
            return window.count <= limit;
        };
        const socketCount = (onlineUsers.get(userId) || 0) + 1;
        onlineUsers.set(userId, socketCount);
        socket.join(`user:${userId}`);
        socket.emit("presence:snapshot", [...onlineUsers.keys()]);
        if (socketCount === 1) io.emit("presence:changed", { userId, online: true });

        socket.on("join_conversation", async (conversationId, acknowledge) => {
            try {
                if (!mongoose.isValidObjectId(conversationId)) throw new Error("Invalid conversation");
                const conversation = await Conversation.findById(conversationId);
                if (!conversation || !isParticipant(conversation, userId)) throw new Error("Access denied");
                await socket.join(roomFor(conversationId));
                joinedConversations.add(String(conversationId));
                if (typeof acknowledge === "function") acknowledge({ ok: true });
            } catch (error) {
                socket.emit("chat_error", error.message || "Unable to open conversation");
                if (typeof acknowledge === "function") acknowledge({ error: error.message || "Unable to open conversation" });
            }
        });

        socket.on("leave_conversation", conversationId => {
            if (mongoose.isValidObjectId(conversationId)) {
                joinedConversations.delete(String(conversationId));
                socket.leave(roomFor(conversationId));
            }
        });

        socket.on("send_message", async (data, acknowledge) => {
            try {
                if (!withinRateLimit("send_message", 60, 60_000)) throw new Error("You're sending messages too quickly");
                const conversationId = String(data?.conversationId || "");
                const text = String(data?.text || "").trim();
                const clientMessageId = String(data?.clientMessageId || "").slice(0, 100);

                if (!mongoose.isValidObjectId(conversationId)) throw new Error("Invalid conversation");
                if (!text || text.length > 5000) throw new Error("Message must be 1 to 5000 characters");

                const conversation = await Conversation.findById(conversationId);
                if (!conversation || !isParticipant(conversation, socket.user._id)) {
                    throw new Error("Access denied");
                }

                const existing = clientMessageId
                    ? await Message.findOne({ conversation: conversation._id, sender: socket.user._id, clientMessageId })
                    : null;
                if (existing) {
                    await existing.populate("sender", "username");
                    await existing.populate("receiver", "username");
                    io.to(roomFor(conversationId))
                        .to(`user:${socket.user._id}`)
                        .to(`user:${existing.receiver?._id || existing.receiver}`)
                        .emit("new_message", existing);
                    if (typeof acknowledge === "function") acknowledge({ ok: true, message: existing });
                    return;
                }

                const receiver = conversation.participants.find(
                    id => id.toString() !== socket.user._id.toString()
                );

                const previousLastMessage = conversation.lastMessage;
                const message = await Message.create({
                    conversation: conversation._id,
                    sender: socket.user._id,
                    receiver,
                    type: "text",
                    text,
                    clientMessageId: clientMessageId || undefined
                });

                try {
                    conversation.lastMessage = message._id;
                    await conversation.save();
                } catch (error) {
                    await Message.deleteOne({ _id: message._id }).catch(() => {});
                    conversation.lastMessage = previousLastMessage;
                    await conversation.save().catch(() => {});
                    throw error;
                }

                await message.populate("sender", "username");
                await message.populate("receiver", "username");

                io.to(roomFor(conversationId))
                    .to(`user:${socket.user._id}`)
                    .to(`user:${receiver}`)
                    .emit("new_message", message);
                if (typeof acknowledge === "function") acknowledge({ ok: true, message });
            } catch (error) {
                if (error.code === 11000 && data?.clientMessageId) {
                    const message = await Message.findOne({
                        conversation: data.conversationId,
                        sender: socket.user._id,
                        clientMessageId: data.clientMessageId
                    });
                    if (message && typeof acknowledge === "function") return acknowledge({ ok: true, message });
                }
                const message = error.message || "Unable to send message";
                socket.emit("chat_error", message);
                if (typeof acknowledge === "function") acknowledge({ error: message });
            }
        });

        socket.on("typing", async data => {
            const conversationId = String(data?.conversationId || "");
            if (!withinRateLimit("typing", 45, 60_000) || !joinedConversations.has(conversationId)) return;
            socket.to(roomFor(conversationId)).emit("typing", { conversationId, userId, typing: Boolean(data.typing) });
        });

        socket.on("call:invite", async (data, acknowledge) => {
            const fail = message => {
                if (typeof acknowledge === "function") acknowledge({ error: message });
                else socket.emit("call:error", { message });
            };
            if (!withinRateLimit("call:invite", 8, 60_000)) return fail("Too many call attempts. Try again shortly.");
            try {
                const conversationId = String(data?.conversationId || "");
                const targetUserId = String(data?.targetUserId || "");
                const mode = data?.mode;
                if (!mongoose.isValidObjectId(conversationId) || !mongoose.isValidObjectId(targetUserId)) {
                    return fail("Invalid conversation or participant");
                }
                if (mode !== "audio" && mode !== "video") return fail("Unsupported call type");
                const configuredIceServers = iceServers();
                if (!configuredIceServers) return fail("ICE server configuration is invalid");

                const conversation = await Conversation.findById(conversationId).populate("participants", "username");
                if (!conversation || !isParticipant(conversation, userId) || !isParticipant(conversation, targetUserId)) {
                    return fail("Access denied");
                }
                if (targetUserId === userId) return fail("You cannot call yourself");
                if (userCalls.has(userId) || userCalls.has(targetUserId)) return fail("One of the users is already on a call");

                const caller = conversation.participants.find(user => user._id.toString() === userId);
                const call = {
                    callId: crypto.randomUUID(),
                    conversationId,
                    users: [userId, targetUserId],
                    callerId: userId,
                    calleeId: targetUserId,
                    callerSocketId: socket.id,
                    calleeSocketId: null,
                    mode,
                    status: "ringing",
                    endedBy: null,
                    timer: null
                };
                calls.set(call.callId, call);
                userCalls.set(userId, call.callId);
                userCalls.set(targetUserId, call.callId);
                call.timer = setTimeout(() => finishCall(call, "unanswered"), 45_000);
                call.timer.unref?.();

                emitToUser(targetUserId, "call:incoming", {
                    callId: call.callId,
                    conversationId,
                    callerId: userId,
                    callerName: caller?.username || "Chat user",
                    mode
                });
                if (typeof acknowledge === "function") acknowledge({ ok: true, callId: call.callId, iceServers: configuredIceServers });
            } catch {
                fail("Unable to start this call");
            }
        });

        socket.on("call:accept", (data, acknowledge) => {
            const call = calls.get(String(data?.callId || ""));
            if (!call || call.calleeId !== userId || call.status !== "ringing") {
                if (typeof acknowledge === "function") acknowledge({ error: "This call is no longer available" });
                return;
            }
            clearTimeout(call.timer);
            call.status = "connecting";
            call.calleeSocketId = socket.id;
            emitToUser(call.callerId, "call:accepted", { callId: call.callId });
            if (typeof acknowledge === "function") acknowledge({ ok: true, iceServers: iceServers() });
        });

        socket.on("call:reject", (data, acknowledge) => {
            const call = calls.get(String(data?.callId || ""));
            if (!call || !call.users.includes(userId)) return;
            call.endedBy = userId;
            finishCall(call, "rejected");
            if (typeof acknowledge === "function") acknowledge({ ok: true });
        });

        socket.on("call:end", (data, acknowledge) => {
            const call = calls.get(String(data?.callId || ""));
            if (!call || !call.users.includes(userId)) return;
            call.endedBy = userId;
            finishCall(call, "ended");
            if (typeof acknowledge === "function") acknowledge({ ok: true });
        });

        const relayCallSignal = (eventName, requiredRole) => (data, acknowledge) => {
            if (!withinRateLimit(eventName, eventName === "call:candidate" ? 1_200 : 40, 60_000)) {
                if (typeof acknowledge === "function") acknowledge({ error: "Too many signaling messages" });
                return;
            }
            const call = calls.get(String(data?.callId || ""));
            const expectedUser = requiredRole === "caller" ? call?.callerId : requiredRole === "callee" ? call?.calleeId : null;
            if (!call || !call.users.includes(userId) || (expectedUser && expectedUser !== userId)) {
                if (typeof acknowledge === "function") acknowledge({ error: "Call signaling is not authorized" });
                return;
            }
            if ((eventName === "call:offer" || eventName === "call:answer") &&
                (!data.description || typeof data.description.sdp !== "string" || data.description.sdp.length > 90_000)) {
                if (typeof acknowledge === "function") acknowledge({ error: "Invalid call description" });
                return;
            }
            if (eventName === "call:candidate" && data.candidate &&
                (typeof data.candidate.candidate !== "string" || data.candidate.candidate.length > 4_000)) {
                if (typeof acknowledge === "function") acknowledge({ error: "Invalid ICE candidate" });
                return;
            }
            const recipient = call.users.find(id => id !== userId);
            emitToUser(recipient, eventName, { callId: call.callId, description: data.description, candidate: data.candidate });
            if (typeof acknowledge === "function") acknowledge({ ok: true });
        };

        socket.on("call:offer", relayCallSignal("call:offer", "caller"));
        socket.on("call:answer", relayCallSignal("call:answer", "callee"));
        socket.on("call:candidate", relayCallSignal("call:candidate"));

        socket.on("disconnect", async () => {
            const activeCallId = userCalls.get(userId);
            const activeCall = calls.get(activeCallId);
            if (activeCall && (activeCall.callerSocketId === socket.id || activeCall.calleeSocketId === socket.id)) {
                activeCall.endedBy = userId;
                finishCall(activeCall, "peer_disconnected");
            }
            const remaining = Math.max((onlineUsers.get(userId) || 1) - 1, 0);
            if (remaining) {
                onlineUsers.set(userId, remaining);
            } else {
                onlineUsers.delete(userId);
                io.emit("presence:changed", { userId, online: false });
                await User.findByIdAndUpdate(userId, { lastSeen: new Date() }).catch(() => {});
            }
        });
    });
};

module.exports = initializeChatSocket;

require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const { Server } = require("socket.io");

const connectDB = require("./config/database");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const conversationRoutes = require("./routes/conversations");
const messageRoutes = require("./routes/messages");
const errorHandler = require("./middleware/errorHandler");
const initializeChatSocket = require("./socket/chatSocket");

const app = express();
const server = http.createServer(app);
app.set("trust proxy", 1);

const allowedOrigin = process.env.CLIENT_URL || "http://localhost:3000";

app.use(helmet({
    crossOriginResourcePolicy: { policy: "same-site" }
}));

app.use(cors({
    origin: allowedOrigin,
    credentials: true
}));

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(cookieParser());

app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false
}));

app.use(express.static(path.join(__dirname, "../client")));
app.use("/css", express.static(path.join(__dirname, "../css")));
app.use("/js", express.static(path.join(__dirname, "../js")));
app.use("/images", express.static(path.join(__dirname, "../images")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../client/auth.html"));
});
app.get("/healthz", (req, res) => res.status(200).json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/messages", messageRoutes);

app.use(errorHandler);

const io = new Server(server, {
    cors: {
        origin: allowedOrigin,
        credentials: true
    },
    maxHttpBufferSize: 100000
});

initializeChatSocket(io);
app.set("io", io);

const PORT = process.env.PORT || 3000;

const start = async () => {
    if (!process.env.MONGO_URI || !process.env.JWT_SECRET) {
        console.error("MONGO_URI and JWT_SECRET are required in .env");
        process.exit(1);
    }

    await connectDB();

    server.listen(PORT, () => {
        console.log("HTTP server is listening");
    });
};

start();

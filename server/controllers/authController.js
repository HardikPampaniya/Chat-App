const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const setAuthCookie = (res, token) => {
    res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: "/"
    });
};

const register = async (req, res) => {
    const username = String(req.body.username || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (username.length < 3 || username.length > 30) {
        return res.status(400).json({ message: "Username must be 3 to 30 characters" });
    }

    if (!emailPattern.test(email)) {
        return res.status(400).json({ message: "Enter a valid email address" });
    }

    if (password.length < 8 || password.length > 128) {
        return res.status(400).json({ message: "Password must be 8 to 128 characters" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
        return res.status(409).json({ message: "Email is already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ username, email, passwordHash });

    res.status(201).json({
        message: "Registration successful",
        user: { id: user._id, username: user.username, email: user.email }
    });
};

const login = async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!emailPattern.test(email) || password.length > 128) {
        return res.status(401).json({ message: "Invalid email or password" });
    }

    const user = await User.findOne({ email });
    if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
        return res.status(401).json({ message: "Invalid email or password" });
    }

    user.lastSeen = new Date();
    await user.save();

    const token = jwt.sign(
        { userId: user._id.toString() },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );

    setAuthCookie(res, token);

    res.json({
        message: "Login successful",
        user: { id: user._id, username: user.username, email: user.email }
    });
};

const logout = (req, res) => {
    res.clearCookie("token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/"
    });

    res.json({ message: "Logged out" });
};

const me = async (req, res) => {
    res.json({
        user: {
            id: req.user._id,
            username: req.user.username,
            email: req.user.email,
            lastSeen: req.user.lastSeen,
            createdAt: req.user.createdAt
        }
    });
};

module.exports = { register, login, logout, me };

const User = require("../models/User");

const getUsers = async (req, res) => {
    const users = await User.find({ _id: { $ne: req.user._id } })
        .select("username email lastSeen")
        .sort({ username: 1 })
        .limit(100);

    res.json({ users });
};

module.exports = { getUsers };

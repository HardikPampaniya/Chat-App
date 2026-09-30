const state = {
    currentUser: null,
    selectedUser: null,
    conversation: null,
    users: [],
    socket: null
};

const userList = document.getElementById("userList");
const messages = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.querySelector(".send-btn");
const messageForm = document.getElementById("messageForm");
const mediaInput = document.getElementById("mediaInput");

const api = async (url, options = {}) => {
    const response = await fetch(url, { credentials: "include", ...options });
    if (response.status === 401) {
        window.location.href = "/";
        throw new Error("Authentication required");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Request failed");
    return data;
};

const escapeText = value => String(value ?? "");

const formatTime = date => new Date(date).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
});

const renderMessage = message => {
    const mine = message.sender?._id === state.currentUser.id || message.sender === state.currentUser.id;
    const row = document.createElement("div");
    row.className = `message-row ${mine ? "mine" : "theirs"}`;

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if (message.type === "image" || message.type === "video") {
        const media = document.createElement(message.type === "image" ? "img" : "video");
        media.className = "media";
        media.src = `/api/messages/media/${encodeURIComponent(message.media.filename)}`;
        if (message.type === "video") media.controls = true;
        media.loading = "lazy";
        bubble.appendChild(media);
    } else {
        bubble.textContent = escapeText(message.text);
    }

    const time = document.createElement("div");
    time.className = "message-time";
    time.textContent = formatTime(message.createdAt);
    bubble.appendChild(time);

    row.appendChild(bubble);
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
};

const renderMessages = list => {
    messages.innerHTML = "";
    list.forEach(renderMessage);
};

const renderUsers = () => {
    const search = document.getElementById("userSearch").value.toLowerCase().trim();
    userList.innerHTML = "";

    state.users
        .filter(user => `${user.username} ${user.email}`.toLowerCase().includes(search))
        .forEach(user => {
            const button = document.createElement("button");
            button.className = `user-item ${state.selectedUser?.id === user._id ? "active" : ""}`;

            const avatar = document.createElement("div");
            avatar.className = "avatar";
            avatar.textContent = user.username.charAt(0).toUpperCase();

            const info = document.createElement("div");
            const name = document.createElement("div");
            name.className = "user-name";
            name.textContent = user.username;
            const email = document.createElement("div");
            email.className = "user-email";
            email.textContent = user.email;

            info.append(name, email);
            button.append(avatar, info);
            button.addEventListener("click", () => selectUser(user));
            userList.appendChild(button);
        });
};

const selectUser = async user => {
    state.selectedUser = user;
    renderUsers();

    document.getElementById("chatTitle").textContent = user.username;
    document.getElementById("chatStatus").textContent = "Private conversation";
    messageInput.disabled = false;
    sendBtn.disabled = false;

    try {
        const data = await api(`/api/conversations/${user._id}`, { method: "POST" });
        state.conversation = data.conversation;
        state.socket.emit("join_conversation", state.conversation._id);

        const messageData = await api(`/api/messages/${state.conversation._id}`);
        renderMessages(messageData.messages);
    } catch (error) {
        alert(error.message);
    }
};

const initSocket = () => {
    state.socket = io({ withCredentials: true });

    state.socket.on("connect_error", () => {
        console.error("Socket authentication failed");
    });

    state.socket.on("new_message", message => {
        if (state.conversation && message.conversation === state.conversation._id) {
            renderMessage(message);
        }
    });

    state.socket.on("chat_error", message => console.error(message));
};

messageForm.addEventListener("submit", event => {
    event.preventDefault();
    const text = messageInput.value.trim();

    if (!state.conversation || !text) return;

    state.socket.emit("send_message", {
        conversationId: state.conversation._id,
        text
    });

    messageInput.value = "";
});

mediaInput.addEventListener("change", async () => {
    const file = mediaInput.files[0];
    mediaInput.value = "";

    if (!file || !state.conversation) return;
    if (file.size > 50 * 1024 * 1024) {
        alert("Maximum file size is 50 MB");
        return;
    }

    const formData = new FormData();
    formData.append("media", file);

    try {
        const data = await api(`/api/messages/${state.conversation._id}/media`, {
            method: "POST",
            body: formData
        });
        renderMessage(data.message);
    } catch (error) {
        alert(error.message);
    }
});

document.getElementById("userSearch").addEventListener("input", renderUsers);

document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
});

(async () => {
    try {
        const me = await api("/api/auth/me");
        state.currentUser = {
            id: me.user.id.toString(),
            username: me.user.username,
            email: me.user.email
        };
        document.getElementById("currentUser").textContent = me.user.email;

        const data = await api("/api/users");
        state.users = data.users;
        renderUsers();
        initSocket();
    } catch (error) {
        console.error(error);
    }
})();

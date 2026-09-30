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

(async () => {
    try {
        const data = await api("/api/auth/me");
        const user = data.user;
        document.getElementById("profileUsername").textContent = user.username;
        document.getElementById("profileEmail").textContent = user.email;
        document.getElementById("avatar").textContent = user.username.charAt(0).toUpperCase();
        document.getElementById("profileCreated").textContent = user.lastSeen
            ? new Date(user.lastSeen).toLocaleDateString()
            : "—";
    } catch (error) {
        console.error(error);
    }
})();

document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
});

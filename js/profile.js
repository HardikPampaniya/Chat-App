const api = async (url, options = {}) => {
    const response = await fetch(url, { credentials: "include", ...options });
    if (response.status === 401) {
        window.location.href = "/";
        throw new Error("Your session has ended. Sign in again.");
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
        document.getElementById("profileCreated").textContent = user.createdAt
            ? new Date(user.createdAt).toLocaleDateString()
            : "—";
        document.getElementById("profileMessage").textContent = "";
    } catch (error) {
        document.getElementById("profileMessage").textContent = error.message || "Could not load your profile.";
    }
})();

document.getElementById("logoutBtn").addEventListener("click", async () => {
    const button = document.getElementById("logoutBtn");
    button.disabled = true;
    try {
        await api("/api/auth/logout", { method: "POST" });
        window.location.href = "/";
    } catch (error) {
        button.disabled = false;
        document.getElementById("profileMessage").textContent = error.message || "Could not log out. Please try again.";
    }
});

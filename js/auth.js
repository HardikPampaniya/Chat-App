const tabs = document.querySelectorAll(".tab");
const forms = document.querySelectorAll(".auth-form");

const showMessage = (id, message, success = false) => {
    const el = document.getElementById(id);
    el.textContent = message;
    el.style.color = success ? "#16803a" : "#c93645";
};

tabs.forEach(tab => {
    tab.addEventListener("click", () => {
        tabs.forEach(item => item.classList.remove("active"));
        forms.forEach(form => form.classList.remove("active"));
        tab.classList.add("active");
        document.getElementById(tab.dataset.form).classList.add("active");
    });
});

document.getElementById("loginForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
        const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
                email: document.getElementById("loginEmail").value,
                password: document.getElementById("loginPassword").value
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Login failed");

        showMessage("loginMessage", "Login successful. Opening chat...", true);
        window.location.href = "/chat.html";
    } catch (error) {
        showMessage("loginMessage", error.message);
    }
});

document.getElementById("registerForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
        const response = await fetch("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
                username: document.getElementById("registerUsername").value,
                email: document.getElementById("registerEmail").value,
                password: document.getElementById("registerPassword").value
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Registration failed");

        showMessage("registerMessage", "Account created. Please log in.", true);
        document.getElementById("registerForm").reset();
        document.querySelector('[data-form="loginForm"]').click();
    } catch (error) {
        showMessage("registerMessage", error.message);
    }
});

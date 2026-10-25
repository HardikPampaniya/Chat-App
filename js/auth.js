const tabs = [...document.querySelectorAll(".tab")];
const forms = [...document.querySelectorAll(".auth-form")];

const showMessage = (id, message, success = false) => {
    const element = document.getElementById(id);
    element.textContent = message;
    element.classList.toggle("success", success);
};

const activateForm = (formId, focus = false) => {
    tabs.forEach(tab => {
        const active = tab.dataset.form === formId;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
    });
    forms.forEach(form => {
        const active = form.id === formId;
        form.classList.toggle("active", active);
        form.hidden = !active;
    });
    if (focus) tabs.find(tab => tab.dataset.form === formId)?.focus();
};

tabs.forEach(tab => {
    tab.addEventListener("click", () => activateForm(tab.dataset.form));
    tab.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = tabs.indexOf(tab);
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
        activateForm(tabs[next].dataset.form, true);
    });
});

const submitForm = async ({ form, endpoint, payload, messageId, successMessage, onSuccess }) => {
    const button = form.querySelector("button[type=submit]");
    const originalText = button.querySelector("span:first-child").textContent;
    button.disabled = true;
    button.querySelector("span:first-child").textContent = "Please wait…";
    showMessage(messageId, "");

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload())
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || "Something went wrong. Please try again.");
        showMessage(messageId, successMessage(data), true);
        await onSuccess?.(data);
    } catch (error) {
        showMessage(messageId, error.message || "Network error. Please try again.");
    } finally {
        button.disabled = false;
        button.querySelector("span:first-child").textContent = originalText;
    }
};

const loginForm = document.getElementById("loginForm");
loginForm.addEventListener("submit", event => {
    event.preventDefault();
    submitForm({
        form: loginForm,
        endpoint: "/api/auth/login",
        messageId: "loginMessage",
        successMessage: () => "Signed in. Opening your chats…",
        payload: () => ({
            email: document.getElementById("loginEmail").value,
            password: document.getElementById("loginPassword").value
        }),
        onSuccess: () => { window.location.href = "/chat.html"; }
    });
});

const registerForm = document.getElementById("registerForm");
registerForm.addEventListener("submit", event => {
    event.preventDefault();
    submitForm({
        form: registerForm,
        endpoint: "/api/auth/register",
        messageId: "registerMessage",
        successMessage: () => "Your account is ready. Sign in to continue.",
        payload: () => ({
            username: document.getElementById("registerUsername").value,
            email: document.getElementById("registerEmail").value,
            password: document.getElementById("registerPassword").value
        }),
        onSuccess: () => {
            const email = document.getElementById("registerEmail").value;
            registerForm.reset();
            activateForm("loginForm");
            document.getElementById("loginEmail").value = email;
            showMessage("loginMessage", "Account created. Sign in with your new account.", true);
            document.getElementById("loginPassword").focus();
        }
    });
});

activateForm("loginForm");

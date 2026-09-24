const form = document.getElementById("chat-form");
const input = document.getElementById("message");
const chat = document.getElementById("chat");
const sendButton = document.getElementById("send-button");

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const message = input.value.trim();

    if (!message) return;

    // Add Shikhar's message
    addMessage("Shikhar", message, "user");

    // Clear input
    input.value = "";

    // Disable button while Saira thinks
    sendButton.disabled = true;
    sendButton.textContent = "Thinking...";

    // Add temporary Saira message
    const thinkingMessage = addMessage(
        "Saira",
        "Thinking...",
        "saira"
    );

    try {

        const response = await fetch("/api/chat", {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                message: message
            })
        });

        const data = await response.json();

        // Replace "Thinking..." with Saira's response
        thinkingMessage.querySelector("p").textContent =
            data.reply || data.error || "I couldn't process that.";

    } catch (error) {

        console.error(error);

        thinkingMessage.querySelector("p").textContent =
            "I'm having trouble connecting to my AI system.";
    }

    sendButton.disabled = false;
    sendButton.textContent = "Send";
});


function addMessage(sender, text, type) {

    // Remove welcome screen after first message
    const welcome = document.querySelector(".welcome");

    if (welcome) {
        welcome.remove();
    }

    const messageElement = document.createElement("div");

    messageElement.className = `message ${type}`;

    messageElement.innerHTML = `
        <div class="message-name">${sender}</div>
        <p>${text}</p>
    `;

    chat.appendChild(messageElement);

    chat.scrollTop = chat.scrollHeight;

    return messageElement;
}
const form = document.getElementById("chat-form");
const input = document.getElementById("message");
const chat = document.getElementById("chat");
const sendButton = document.getElementById("send-button");

// ==========================================
// TEXT-TO-SPEECH (Saira speaks out loud)
// ==========================================
function speakResponse(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        
        const voices = window.speechSynthesis.getVoices();
        const voice = voices.find(v => v.name.includes('Google') || v.name.includes('Natural') || v.lang.includes('en'));
        if (voice) utterance.voice = voice;

        window.speechSynthesis.speak(utterance);
    }
}

// ==========================================
// SPEECH-TO-TEXT (Microphone Voice Input)
// ==========================================
let recognition = null;
if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;

    recognition.onresult = (event) => {
        const speechText = event.results[0][0].transcript;
        if (input) input.value = speechText;
        form.requestSubmit(); // Automatically submit form after speaking
    };
}

function startVoiceInput() {
    if (!recognition) {
        alert("Speech recognition is not supported in this browser. Try Chrome or Safari.");
        return;
    }
    try {
        recognition.start();
    } catch (e) {
        recognition.stop();
    }
}

// ==========================================
// FORM SUBMISSION & CHAT LOGIC
// ==========================================
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
        const reply = data.reply || data.error || "I couldn't process that.";

        // Replace "Thinking..." with Saira's response
        thinkingMessage.querySelector("p").textContent = reply;
        
        // Speak response out loud (JARVIS mode)
        speakResponse(reply);

    } catch (error) {
        console.error(error);
        const errorMsg = "I'm having trouble connecting to my AI system.";
        thinkingMessage.querySelector("p").textContent = errorMsg;
        speakResponse(errorMsg);
    } finally {
        sendButton.disabled = false;
        sendButton.textContent = "Send";
    }
});

// ==========================================
// ADD MESSAGE HELPER
// ==========================================
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
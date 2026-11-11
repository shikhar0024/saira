require("dotenv").config();
const express = require("express");
const basicAuth = require("express-basic-auth");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { GoogleGenAI } = require("@google/genai");
const Parser = require("rss-parser");

const app = express();
const PORT = process.env.PORT || 3000;

// Security: Personal Access Authentication
app.use(basicAuth({
    users: { 'Shikhar': 'saira_secure_2026' }, // Change your password here if desired
    challenge: true,
    realm: 'Saira AI Personal Access'
}));

app.use(express.json());
app.use(express.static("public"));

// PostgreSQL or fallback JSON setup for memories
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDatabase() {
    if (!process.env.DATABASE_URL) {
        return;
    }
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS memories (
                id SERIAL PRIMARY KEY,
                memory TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("PostgreSQL memory table is ready.");
    } catch (error) {
        console.error("Database initialization error:", error);
    }
}
initDatabase();

// Gemini Client
const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

const memoryFile = path.join(__dirname, "data", "memory.json");
let memories = [];

async function loadMemories() {
    if (process.env.DATABASE_URL) {
        try {
            const result = await pool.query("SELECT memory FROM memories ORDER BY id ASC");
            memories = result.rows.map(row => row.memory);
        } catch (error) {
            console.error("Error loading from DB:", error);
        }
    } else {
        try {
            memories = JSON.parse(fs.readFileSync(memoryFile, "utf8"));
        } catch (error) {
            memories = [];
        }
    }
}
loadMemories();

async function saveMemories() {
    if (process.env.DATABASE_URL) {
        try {
            await pool.query(
                "INSERT INTO memories (memory) VALUES ($1)",
                [memories[memories.length - 1]]
            );
        } catch (error) {
            console.error("Error saving to DB:", error);
        }
    } else {
        try {
            if (!fs.existsSync(path.dirname(memoryFile))) {
                fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
            }
            fs.writeFileSync(memoryFile, JSON.stringify(memories, null, 2));
        } catch (error) {
            console.error("Error saving to file:", error);
        }
    }
}

// ==========================================
// HEALTH CHECK
// ==========================================
app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Saira is running!" });
});

// ==========================================
// WEATHER API
// ==========================================
app.get("/api/weather", async (req, res) => {
    try {
        const city = req.query.city || "Mumbai";
        const geoResponse = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
        const geoData = await geoResponse.json();

        if (!geoData.results || geoData.results.length === 0) {
            return res.status(404).json({ error: `I couldn't find the city "${city}".` });
        }

        const location = geoData.results[0];
        const weatherResponse = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,wind_speed_10m,weather_code`);
        const weatherData = await weatherResponse.json();

        res.json({
            city: location.name,
            country: location.country,
            temperature: weatherData.current.temperature_2m,
            feelsLike: weatherData.current.apparent_temperature,
            humidity: weatherData.current.relative_humidity_2m,
            precipitation: weatherData.current.precipitation,
            windSpeed: weatherData.current.wind_speed_10m,
            weatherCode: weatherData.current.weather_code,
            time: weatherData.current.time
        });
    } catch (error) {
        console.error("Weather Error:", error);
        res.status(500).json({ error: "I couldn't get the weather right now." });
    }
});

// ==========================================
// NEWS API
// ==========================================
app.get("/api/news", async (req, res) => {
    try {
        const query = req.query.topic || "India";
        const parser = new Parser();
        const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
        const feed = await parser.parseURL(feedUrl);

        const articles = feed.items.slice(0, 5).map(item => ({
            title: item.title,
            link: item.link,
            published: item.pubDate
        }));

        res.json({ topic: query, articles });
    } catch (error) {
        console.error("News Error:", error);
        res.status(500).json({ error: "I couldn't fetch the news right now." });
    }
});

// ==========================================
// CHAT WITH SAIRA (GEMINI AI)
// ==========================================
app.post("/api/chat", async (req, res) => {
    try {
        const userMessage = req.body.message;
        if (!userMessage) {
            return res.status(400).json({ error: "Message is required." });
        }

        const lowerMsg = userMessage.toLowerCase();
        
        // Handle Memory Recall Requests
        if (lowerMsg.includes("what do you remember") || lowerMsg.includes("my details") || lowerMsg.includes("what do you know about me")) {
            if (memories.length === 0) {
                return res.json({ reply: "I don't have any specific memories saved about you yet, Shikhar. Tell me something important and I'll remember it!" });
            }
            return res.json({ reply: `Here is what I remember about you, Shikhar:\n• ` + memories.join("\n• ") });
        }

        // Handle Memory Saving Requests
        const rememberMatch = userMessage.match(/remember that (.+)/i);
        if (rememberMatch) {
            const newMemory = rememberMatch[1].trim();
            memories.push(newMemory);
            await saveMemories();
            return res.json({ reply: `Got it, Shikhar. I've noted that down: "${newMemory}".` });
        }

        // Build System Prompt & Memory Context
        const memoryContext = memories.length > 0 ? `\n\nThings you remember about Shikhar:\n- ${memories.join("\n- ")}` : "";
        const systemPrompt = `You are Saira, Shikhar's personal AI assistant, inspired by JARVIS. Be friendly, intelligent, helpful, conversational, clear, and practical. The person you're assisting is Shikhar. Address him as Shikhar when appropriate.${memoryContext}`;

        // Call Gemini AI
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                { role: 'user', parts: [{ text: systemPrompt + "\n\nUser: " + userMessage }] }
            ]
        });

        const reply = response.text || "I am here, Shikhar.";
        res.json({ reply });

    } catch (error) {
        console.error("Chat Error:", error);
        res.status(500).json({ error: "Saira encountered an error processing your request." });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Saira is running at http://localhost:${PORT}`);
});
require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});
async function initDatabase() {
    if (!process.env.DATABASE_URL) {
        return;
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS memories (
            id SERIAL PRIMARY KEY,
            memory TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    console.log("PostgreSQL memory table is ready.");
}
const { GoogleGenAI } = require("@google/genai");
const Parser = require("rss-parser");

const app = express();
const PORT = process.env.PORT || 3000;

// Gemini
const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

app.use(express.json());
let chatHistory = [];
const memoryFile = path.join(__dirname, "data", "memory.json");

let memories = [];

async function loadMemories() {
    if (process.env.DATABASE_URL) {
        const result = await pool.query(
            "SELECT memory FROM memories ORDER BY id ASC"
        );

        memories = result.rows.map(row => row.memory);
    } else {
        try {
            memories = JSON.parse(fs.readFileSync(memoryFile, "utf8"));
        } catch (error) {
            memories = [];
        }
    }
}
async function saveMemories() {
    if (process.env.DATABASE_URL) {
        await pool.query(
            "INSERT INTO memories (memory) VALUES ($1)",
            [memories[memories.length - 1]]
        );
    } else {
        fs.writeFileSync(memoryFile, JSON.stringify(memories, null, 2));
    }
}
const MAX_HISTORY = 20;
app.use(express.static("public"));


// ========================================
// HEALTH CHECK
// ========================================

app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        message: "Saira is running!"
    });
});


// ========================================
// WEATHER
// ========================================

app.get("/api/weather", async (req, res) => {

    try {

        const city = req.query.city || "Mumbai";

        // Find city coordinates
        const geoResponse = await fetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
        );

        const geoData = await geoResponse.json();

        if (!geoData.results || geoData.results.length === 0) {

            return res.status(404).json({
                error: `I couldn't find the city "${city}".`
            });

        }

        const location = geoData.results[0];

        // Get current weather
        const weatherResponse = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&timezone=auto`
        );

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

        res.status(500).json({
            error: "I couldn't get the weather right now."
        });

    }

});


// ========================================
// CHAT WITH SAIRA
// ========================================
// NEWS
app.get("/api/news", async (req, res) => {
    try {
        const query = req.query.topic || "India";

        const parser = new Parser();

        const feedUrl =
            `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;

        const feed = await parser.parseURL(feedUrl);

        const articles = feed.items.slice(0, 5).map((item) => ({
            title: item.title,
            link: item.link,
            published: item.pubDate
        }));

        res.json({
            topic: query,
            articles
        });

    } catch (error) {
        console.error("News Error:", error);

        res.status(500).json({
            error: "I couldn't get the latest news right now."
        });
    }
});
// CHAT
app.post("/api/chat", async (req, res) => {
    try {
        const { message } = req.body;

        const rememberMatch = message.match(
    /remember(?: that)?\s+(.+)/i
);
console.log("Remember match:", rememberMatch);

if (rememberMatch) {
    const memory = rememberMatch[1].trim();

    memories.push(memory);
    saveMemories();

    return res.json({
        reply: `Got it, Shikhar. I'll remember that: ${memory}`
    });
}

         chatHistory.push({
    role: "user",
    content: message
});
if (chatHistory.length > MAX_HISTORY) {
    chatHistory = chatHistory.slice(-MAX_HISTORY);
}
        if (!message) {
            return res.status(400).json({
                error: "Please enter a message."
            });
        }

        // WEATHER QUESTIONS
       const weatherMatch = message.match(
    /weather\s+(?:in|at|for)\s+([a-zA-Z\s]+?)(?:\?|$)/i
);

if (weatherMatch) {
    const city = weatherMatch[1].trim();

            const geoResponse = await fetch(
                `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
            );

            const geoData = await geoResponse.json();

            if (!geoData.results || geoData.results.length === 0) {
                return res.json({
                    reply: `I couldn't find weather information for ${city}.`
                });
            }

            const location = geoData.results[0];

            const weatherResponse = await fetch(
                `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&timezone=auto`
            );

            const weatherData = await weatherResponse.json();
            const current = weatherData.current;

            return res.json({
                reply: `The current weather in ${location.name}, ${location.country} is ${current.temperature_2m}°C, with a feels-like temperature of ${current.apparent_temperature}°C. Humidity is ${current.relative_humidity_2m}% and wind speed is ${current.wind_speed_10m} km/h.`
            });
        }
// NEWS QUESTIONS
const newsMatch = message.match(
    /(?:latest|today'?s|recent|current)\s+(.*?)(?:\s+)?news/i
);

if (
    newsMatch ||
    /what'?s happening|what is happening|news today|current affairs/i.test(message)
) {
    let topic = "India";

    if (newsMatch && newsMatch[1]) {
        topic = newsMatch[1].trim();
    }

    // Clean common words
    topic = topic
        .replace(/\b(in|from|about|on)\b/gi, "")
        .trim();

    if (!topic || topic.length < 2) {
        topic = "India";
    }

    const parser = new Parser();

    const feedUrl =
        `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-IN&gl=IN&ceid=IN:en`;

    const feed = await parser.parseURL(feedUrl);

    const articles = feed.items.slice(0, 5);

    if (articles.length === 0) {
        return res.json({
            reply: `I couldn't find any recent news about ${topic}.`
        });
    }

    let reply = `Here are the latest news headlines about ${topic}:\n\n`;

    articles.forEach((article, index) => {
        reply += `${index + 1}. ${article.title}\n`;
    });

    return res.json({
        reply
    });
}
        // GENERAL AI CHAT
     const response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: `
You are Saira, Shikhar's personal AI assistant.

Be friendly, intelligent, helpful, natural, conversational, clear and practical.

The person you are assisting is Shikhar.
When appropriate, address him as Shikhar.

Conversation history:
${chatHistory.map(item => `${item.role}: ${item.content}`).join("\n")}

Saved memories:
${memories.join("\n")} 

Respond to the latest user message naturally and use the conversation history when relevant.
`
});   

        res.json({
            reply: response.text
        });

    } catch (error) {
        console.error("Chat Error:", error);

        res.status(500).json({
            error: "Saira could not process your request."
        });
    }
});
// ========================================
// START SERVER
// ========================================
initDatabase()
    .then(() => loadMemories())
    .then(() => {
        app.listen(PORT, "0.0.0.0", () => {
            console.log(`Saira is running at http://localhost:${PORT}`);
        });
    })
    .catch((error) => {
        console.error("Startup error:", error);
        process.exit(1);
    });
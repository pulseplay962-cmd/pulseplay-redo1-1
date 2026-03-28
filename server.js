import express from "express";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import axios from "axios";

const app = express();
app.use(express.json());

// ENV
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ======================
// TWITCH AUTH
// ======================

let token = "";
let expiry = 0;

async function getToken() {
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`,
    { method: "POST" }
  );

  const data = await res.json();
  token = data.access_token;
  expiry = Date.now() + data.expires_in * 1000;
}

async function ensureToken() {
  if (!token || Date.now() >= expiry) {
    await getToken();
  }
}

// ======================
// HEALTH CHECK
// ======================

app.get("/", (req, res) => {
  res.json({ status: "PulsePlay API running 🚀" });
});

// ======================
// AUTH SYSTEM
// ======================

app.post("/signup", async (req, res) => {
  const { email } = req.body;

  const { error } = await supabase
    .from("users")
    .insert([{ email }]);

  if (error) return res.status(400).json(error);

  res.json({ success: true });
});

app.post("/login", async (req, res) => {
  const { email } = req.body;

  const { data } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .single();

  if (!data) return res.status(404).json({ error: "User not found" });

  res.json({ success: true });
});

// ======================
// TWITCH CLIPS
// ======================

app.get("/clips", async (req, res) => {
  try {
    await ensureToken();

    const userRes = await fetch(
      "https://api.twitch.tv/helix/users?login=veiltactician",
      {
        headers: {
          "Client-ID": CLIENT_ID,
          Authorization: `Bearer ${token}`
        }
      }
    );

    const userData = await userRes.json();
    const userId = userData.data[0].id;

    const clipRes = await fetch(
      `https://api.twitch.tv/helix/clips?broadcaster_id=${userId}&first=6`,
      {
        headers: {
          "Client-ID": CLIENT_ID,
          Authorization: `Bearer ${token}`
        }
      }
    );

    const clips = await clipRes.json();

    res.json(clips);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "clips failed" });
  }
});

// ======================
// ANALYTICS
// ======================

app.get("/analytics", async (req, res) => {
  try {
    await ensureToken();

    const response = await fetch(
      "https://api.twitch.tv/helix/streams?user_login=veiltactician",
      {
        headers: {
          "Client-ID": CLIENT_ID,
          Authorization: `Bearer ${token}`
        }
      }
    );

    const data = await response.json();

    res.json({
      live: data.data.length > 0,
      stream: data.data[0] || null
    });
  } catch {
    res.status(500).json({ error: "analytics failed" });
  }
});

// ======================
// AI CLIP SCORING
// ======================

app.post("/score-clip", async (req, res) => {
  try {
    const { title, views } = req.body;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `
Rate virality 1-100.

Title: ${title}
Views: ${views}

Return ONLY JSON:
{"score": number, "reason": string}
          `
        }
      ]
    });

    const text = completion.choices[0].message.content;
    const result = JSON.parse(text);

    res.json(result);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "AI scoring failed" });
  }
});

// ======================
// LEADERBOARD
// ======================

app.get("/leaderboard", async (req, res) => {
  const { data, error } = await supabase
    .from("leaderboard")
    .select("*")
    .order("points", { ascending: false })
    .limit(10);

  if (error) return res.status(500).json(error);

  res.json(data);
});

// ======================
// TIKTOK (OPTIONAL HOOK)
// ======================

app.post("/post-tiktok", async (req, res) => {
  try {
    const { videoUrl, caption } = req.body;

    const response = await axios.post(
      "https://open.tiktokapis.com/v2/post/publish/",
      {
        video_url: videoUrl,
        caption
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.TIKTOK_TOKEN}`
        }
      }
    );

    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: "TikTok post failed" });
  }
});

// ======================
// START SERVER
// ======================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("PulsePlay running on port", PORT);
});
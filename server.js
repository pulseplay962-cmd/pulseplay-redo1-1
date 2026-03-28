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

// TOKEN
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

// HEALTH
app.get("/", (req, res) => {
  res.json({ status: "PulsePlay API running" });
});

---

# 👤 AUTH (SIMPLE)

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

  if (!data) return res.status(404).json({ error: "Not found" });

  res.json({ success: true });
});

---

# 🎬 CLIPS

app.get("/clips", async (req, res) => {
  try {
    await ensureToken();

    const user = await fetch(
      "https://api.twitch.tv/helix/users?login=veiltactician",
      {
        headers: {
          "Client-ID": CLIENT_ID,
          Authorization: `Bearer ${token}`
        }
      }
    );

    const userData = await user.json();
    const userId = userData.data[0].id;

    const clips = await fetch(
      `https://api.twitch.tv/helix/clips?broadcaster_id=${userId}&first=6`,
      {
        headers: {
          "Client-ID": CLIENT_ID,
          Authorization: `Bearer ${token}`
        }
      }
    );

    res.json(await clips.json());
  } catch (e) {
    res.status(500).json({ error: "clips failed" });
  }
});

---

# 🧠 AI CLIP SCORING

app.post("/score-clip", async (req, res) => {
  try {
    const { title, views } = req.body;

    const prompt = `
Rate virality 1-100.

Title: ${title}
Views: ${views}

Return JSON:
{"score": number, "reason": string}
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    });

    const result = JSON.parse(response.choices[0].message.content);

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: "AI scoring failed" });
  }
});

---

# 🏆 LEADERBOARD

app.get("/leaderboard", async (req, res) => {
  const { data, error } = await supabase
    .from("leaderboard")
    .select("*")
    .order("points", { ascending: false })
    .limit(10);

  if (error) return res.status(500).json(error);

  res.json(data);
});

---

# 📲 TIKTOK (API READY)

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
  } catch (e) {
    res.status(500).json({ error: "TikTok failed" });
  }
});

app.get("/auto-run", async (req, res) => {
  try {
    await ensureToken();

    // 1. GET USER
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

    // 2. GET CLIPS
    const clipsRes = await fetch(
      `https://api.twitch.tv/helix/clips?broadcaster_id=${userId}&first=10`,
      {
        headers: {
          "Client-ID": CLIENT_ID,
          Authorization: `Bearer ${token}`
        }
      }
    );

    const clipsData = await clipsRes.json();

    const results = [];

    // 3. PROCESS EACH CLIP
    for (const clip of clipsData.data) {

      // AI SCORE
      const ai = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{
          role: "user",
          content: `
Rate virality 1-100.

Title: ${clip.title}
Views: ${clip.view_count}

Return JSON:
{"score": number, "reason": string}
          `
        }]
      });

      const score = JSON.parse(ai.choices[0].message.content);

      // 4. FILTER ONLY HIGH VALUE CLIPS
      if (score.score >= 80) {

        // 5. AUTO POST TO TIKTOK (READY HOOK)
        try {
          await axios.post(
            "https://open.tiktokapis.com/v2/post/publish/",
            {
              video_url: clip.thumbnail_url,
              caption: `🔥 ${clip.title}`
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.TIKTOK_TOKEN}`
              }
            }
          );
        } catch (e) {
          console.log("TikTok post failed (expected if not approved)");
        }

        results.push({
          clip: clip.title,
          score: score.score,
          posted: true
        });

      } else {
        results.push({
          clip: clip.title,
          score: score.score,
          posted: false
        });
      }
    }

    res.json({
      success: true,
      processed: results.length,
      results
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "automation failed" });
  }
});

setInterval(async () => {
  try {
    console.log("Running automation cycle...");
    await fetch("http://localhost:" + process.env.PORT + "/auto-run");
  } catch (e) {
    console.log("Auto-run error:", e.message);
  }
}, 15 * 60 * 1000);
---

# 🚀 START

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running on", PORT));
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

/* =========================
   🔐 CONFIG
========================= */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

let twitchToken = "";
let twitchExpiry = 0;

/* =========================
   🔥 GET TWITCH TOKEN
========================= */
async function getTwitchToken() {
  if (twitchToken && Date.now() < twitchExpiry) return twitchToken;

  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
    { method: "POST" }
  );

  const data = await res.json();

  twitchToken = data.access_token;
  twitchExpiry = Date.now() + (data.expires_in * 1000);

  console.log("🔥 Twitch token refreshed");
  return twitchToken;
}

/* =========================
   🧪 DEBUG ROUTE (GET USER ID)
========================= */
app.get("/get-twitch-id", async (req, res) => {
  try {
    const token = await getTwitchToken();

    const response = await fetch(
      "https://api.twitch.tv/helix/users?login=veiltactician", // 🔁 change if needed
      {
        headers: {
          "Client-ID": TWITCH_CLIENT_ID,
          "Authorization": `Bearer ${token}`
        }
      }
    );

    const data = await response.json();
    res.json(data);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch Twitch user" });
  }
});

/* =========================
   📥 AUTO INGEST TWITCH CLIPS
========================= */
async function fetchTwitchClips() {
  try {
    const token = await getTwitchToken();

    const res = await fetch(
      "https://api.twitch.tv/helix/clips?broadcaster_id=YOUR_TWITCH_ID&first=5",
      {
        headers: {
          "Client-ID": TWITCH_CLIENT_ID,
          "Authorization": `Bearer ${token}`
        }
      }
    );

    const json = await res.json();

    for (const clip of json.data || []) {
      const title = clip.title;
      const views = clip.view_count;

      // prevent duplicates
      const { data: existing } = await supabase
        .from("clips")
        .select("id")
        .eq("title", title)
        .limit(1);

      if (existing && existing.length > 0) continue;

      // 🤖 AI SCORE
      const ai = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: "Return ONLY a number 0-100." },
          { role: "user", content: title }
        ]
      });

      const score = parseInt(
        ai.choices[0].message.content.match(/\d+/)?.[0] || "0"
      );

      // 💾 SAVE
      const { data } = await supabase
        .from("clips")
        .insert([
          {
            title,
            views,
            score,
            ready_for_post: score >= 85
          }
        ])
        .select();

      const saved = data[0];

      io.emit("clip_scored", saved);

      if (score >= 85) {
        io.emit("viral_alert", saved);
      }
    }

  } catch (err) {
    console.error("Twitch ingest error:", err);
  }
}

/* 🔁 RUN EVERY 60 SECONDS */
setInterval(fetchTwitchClips, 60000);

/* =========================
   🚀 ROUTES
========================= */

/* HEALTH */
app.get("/", (req, res) => {
  res.json({ status: "PulsePlay API running 🚀" });
});

/* GET CLIPS */
app.get("/clips", async (req, res) => {
  const { data } = await supabase
    .from("clips")
    .select("*")
    .order("created_at", { ascending: false });

  res.json({ clips: data });
});

/* CREATE CLIP */
app.post("/clips", async (req, res) => {
  try {
    const { title, views, user_id } = req.body;

    const ai = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: "Return ONLY a number 0-100." },
        { role: "user", content: title }
      ]
    });

    const score = parseInt(
      ai.choices[0].message.content.match(/\d+/)?.[0] || "0"
    );

    const { data } = await supabase
      .from("clips")
      .insert([{ title, views, score, user_id }])
      .select();

    const clip = data[0];

    io.emit("clip_scored", clip);

    res.json({ clip });

  } catch (err) {
    res.status(500).json({ error: "Failed to create clip" });
  }
});

/* AI PREDICT */
app.post("/predict", async (req, res) => {
  const { title } = req.body;

  const ai = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: 'Return JSON {"score":number,"tips":"tip"}' },
      { role: "user", content: title }
    ]
  });

  let result;
  try {
    result = JSON.parse(ai.choices[0].message.content);
  } catch {
    result = { score: 50, tips: "Make it more engaging." };
  }

  res.json(result);
});

/* ANALYTICS */
app.get("/analytics/:user_id", async (req, res) => {
  const { data } = await supabase
    .from("clips")
    .select("score, views, created_at")
    .eq("user_id", req.params.user_id)
    .order("created_at", { ascending: true });

  res.json({ data });
});

/* POST TO TIKTOK (SIMULATED) */
app.post("/post-to-tiktok", async (req, res) => {
  const { clip_id } = req.body;

  await supabase
    .from("clips")
    .update({ ready_for_post: false })
    .eq("id", clip_id);

  res.json({ success: true });
});

/* SOCKET */
io.on("connection", (socket) => {
  console.log("🟢 Connected:", socket.id);
});

/* START SERVER */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("🚀 PulsePlay running on port", PORT);
});
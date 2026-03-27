import express from "express";
import fetch from "node-fetch";

const app = express();

// =======================
// ENV SAFETY CHECK
// =======================
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET in environment variables");
}

// =======================
// TOKEN STORAGE
// =======================
let accessToken = "";
let tokenExpiry = 0;

// =======================
// GET APP ACCESS TOKEN
// =======================
async function getAccessToken() {
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`,
    {
      method: "POST",
    }
  );

  const data = await res.json();

  if (!data.access_token) {
    console.error("❌ Twitch token error:", data);
    throw new Error("Failed to get Twitch access token");
  }

  accessToken = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;

  console.log("✅ New Twitch token acquired");
}

// =======================
// ENSURE VALID TOKEN
// =======================
async function ensureToken() {
  if (!accessToken || Date.now() >= tokenExpiry) {
    await getAccessToken();
  }
}

// =======================
// HEALTH CHECK ROUTE
// =======================
app.get("/", (req, res) => {
  res.send("PulsePlay backend is alive ✅");
});

// =======================
// LIVE STATUS
// =======================
app.get("/live-status", async (req, res) => {
  try {
    await ensureToken();

    const response = await fetch(
      "https://api.twitch.tv/helix/streams?user_login=veiltactician",
      {
        headers: {
          "Client-ID": CLIENT_ID,
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const data = await response.json();

    // If unauthorized, refresh once
    if (data.status === 401) {
      console.log("🔁 Token expired, refreshing...");

      await getAccessToken();

      const retry = await fetch(
        "https://api.twitch.tv/helix/streams?user_login=veiltactician",
        {
          headers: {
            "Client-ID": CLIENT_ID,
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      return res.json(await retry.json());
    }

    res.json(data);
  } catch (err) {
    console.error("❌ live-status error:", err);
    res.status(500).json({ error: "Failed to fetch live status" });
  }
});

// =======================
// GET USER INFO
// =======================
app.get("/get-user", async (req, res) => {
  try {
    await ensureToken();

    const response = await fetch(
      "https://api.twitch.tv/helix/users?login=veiltactician",
      {
        headers: {
          "Client-ID": CLIENT_ID,
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const data = await response.json();

    res.json(data);
  } catch (err) {
    console.error("❌ get-user error:", err);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// =======================
// START SERVER (RENDER SAFE)
// =======================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
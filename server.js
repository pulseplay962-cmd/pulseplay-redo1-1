import express from "express";
import fetch from "node-fetch";

const app = express();

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

let accessToken = "";
let tokenExpiry = 0;

// 🔥 Get fresh token
async function getAccessToken() {
  const res = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`, {
    method: "POST"
  });

  const data = await res.json();

  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000);

  console.log("New Twitch token acquired");
}

// 🔁 Ensure token is valid
async function ensureToken() {
  if (!accessToken || Date.now() >= tokenExpiry) {
    await getAccessToken();
  }
}

app.get("/live-status", async (req, res) => {
  try {
    await ensureToken();

    const response = await fetch("https://api.twitch.tv/helix/streams?user_login=veiltactician", {
      headers: {
        "Client-ID": CLIENT_ID,
        "Authorization": `Bearer ${accessToken}`
      }
    });

    const data = await response.json();

    // 🔥 If token somehow invalid → refresh and retry once
    if (data.status === 401) {
      console.log("Token expired, refreshing...");
      await getAccessToken();

      const retry = await fetch("https://api.twitch.tv/helix/streams?user_login=veiltactician", {
        headers: {
          "Client-ID": CLIENT_ID,
          "Authorization": `Bearer ${accessToken}`
        }
      });

      return res.json(await retry.json());
    }

    res.json(data);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(3000, () => console.log("Server running"));

app.get("/clips", async (req, res) => {
  try {
    await ensureToken();

    const response = await fetch("https://api.twitch.tv/helix/clips?broadcaster_id=YOUR_USER_ID&first=6", {
      headers: {
        "Client-ID": CLIENT_ID,
        "Authorization": `Bearer ${accessToken}`
      }
    });

    const data = await response.json();
    res.json(data);

  } catch (err) {
    res.status(500).json({ error: "Failed to fetch clips" });
  }
});
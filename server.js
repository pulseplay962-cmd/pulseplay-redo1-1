import express from "express";
import fetch from "node-fetch";

const app = express();

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

let accessToken = "";

async function getAccessToken() {
  const res = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`, {
    method: "POST"
  });

  const data = await res.json();
  accessToken = data.access_token;
}

app.get("/live-status", async (req, res) => {
  if (!accessToken) await getAccessToken();

  const response = await fetch("https://api.twitch.tv/helix/streams?user_login=veiltactician", {
    headers: {
      "Client-ID": CLIENT_ID,
      "Authorization": `Bearer ${accessToken}`
    }
  });

  const data = await response.json();
  res.json(data);
});

app.listen(3000, () => console.log("Server running"));
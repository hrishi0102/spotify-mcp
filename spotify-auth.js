import express from "express";
import axios from "axios";
import fs from "fs";

// Replace these with your Spotify app credentials
const CLIENT_ID = "e3e34c8780f1445da29b1ae481169577";
const CLIENT_SECRET = "8f7d56d25e794ab8aef197840e204fb7";
const REDIRECT_URI = "http://localhost:8888/callback";

const app = express();
const PORT = 8888;

app.get("/login", (req, res) => {
  res.redirect(
    `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${REDIRECT_URI}&scope=user-read-private%20user-read-email%20playlist-read-private%20playlist-modify-private%20playlist-modify-public`
  );
});

app.get("/callback", async (req, res) => {
  const code = req.query.code;

  try {
    const tokenResponse = await axios({
      method: "post",
      url: "https://accounts.spotify.com/api/token",
      params: {
        code: code,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      },
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(CLIENT_ID + ":" + CLIENT_SECRET).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    // Save tokens to secrets.json file
    const tokens = {
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      accessToken: tokenResponse.data.access_token,
      refreshToken: tokenResponse.data.refresh_token,
    };

    fs.writeFileSync("secrets.json", JSON.stringify(tokens, null, 2));

    res.send("Authentication successful! Tokens saved to secrets.json");

    setTimeout(() => {
      server.close();
      console.log(
        "Tokens saved to secrets.json. You can now close this window."
      );
    }, 3000);
  } catch (error) {
    res.send("Error during authentication: " + error.message);
  }
});

const server = app.listen(PORT, () => {
  console.log(
    `Please open http://localhost:${PORT}/login in your browser to authenticate`
  );
});

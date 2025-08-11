import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import fetch from "node-fetch";

// Environment variables
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REDIRECT_URI =
  process.env.SPOTIFY_REDIRECT_URI || "http://localhost:8080/callback/spotify";

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
  console.error(
    "Missing required environment variables: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET"
  );
  process.exit(1);
}

console.log("🎵 Spotify Config:");
console.log("- Client ID:", SPOTIFY_CLIENT_ID);
console.log("- Redirect URI:", SPOTIFY_REDIRECT_URI);

// Session storage
const transports = new Map();
const sessionTokens = new Map();

// Simple cleanup function
function cleanupSession(sessionId) {
  console.log(`🧹 Cleaning up session: ${sessionId}`);

  const transport = transports.get(sessionId);
  if (transport) {
    try {
      transport.close();
    } catch (error) {
      console.warn(`Warning closing transport:`, error.message);
    }
    transports.delete(sessionId);
  }

  sessionTokens.delete(sessionId);
}

// Helper functions
function isTokenExpired(tokens) {
  if (!tokens.expiresAt) return true;
  return Date.now() >= tokens.expiresAt;
}

function getSpotifyAuthUrl(sessionId) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: SPOTIFY_CLIENT_ID,
    scope:
      "user-read-private user-read-email playlist-read-private playlist-modify-private playlist-modify-public",
    redirect_uri: SPOTIFY_REDIRECT_URI,
    state: sessionId,
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(SPOTIFY_CLIENT_ID + ":" + SPOTIFY_CLIENT_SECRET).toString(
          "base64"
        ),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Token exchange failed: ${data.error_description || data.error}`
    );
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

async function refreshSpotifyToken(tokens) {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(SPOTIFY_CLIENT_ID + ":" + SPOTIFY_CLIENT_SECRET).toString(
          "base64"
        ),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Token refresh failed: ${data.error_description || data.error}`
    );
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

async function getValidAccessToken(sessionId) {
  let tokens = sessionTokens.get(sessionId);

  if (!tokens) {
    return null;
  }

  if (isTokenExpired(tokens)) {
    try {
      tokens = await refreshSpotifyToken(tokens);
      sessionTokens.set(sessionId, tokens);
    } catch (error) {
      console.log(
        `❌ Token refresh failed for session ${sessionId}:`,
        error.message
      );
      sessionTokens.delete(sessionId);
      return null;
    }
  }

  return tokens.accessToken;
}

async function handleSpotifyTool(sessionId, apiCall) {
  const accessToken = await getValidAccessToken(sessionId);

  if (!accessToken) {
    console.log(`🔐 Auth required for session: ${sessionId}`);
    const baseUrl =
      process.env.SPOTIFY_REDIRECT_URI?.replace("/callback/spotify", "") ||
      "http://localhost:8080";
    const authUrl = `${baseUrl}/auth?session=${sessionId}`;

    return {
      content: [
        {
          type: "text",
          text: `🎵 **Spotify Authentication Required**

To use Spotify features, please visit:

${authUrl}

This will redirect you to connect your Spotify account. After authentication, return here and try your request again.`,
        },
      ],
    };
  }

  try {
    console.log(`✅ Executing Spotify API call for session: ${sessionId}`);
    return await apiCall(accessToken);
  } catch (error) {
    if (error.response?.status === 401) {
      console.log(`❌ Token expired for session: ${sessionId}`);
      sessionTokens.delete(sessionId);
      const baseUrl =
        process.env.SPOTIFY_REDIRECT_URI?.replace("/callback/spotify", "") ||
        "http://localhost:8080";
      const authUrl = `${baseUrl}/auth?session=${sessionId}`;
      return {
        content: [
          {
            type: "text",
            text: `🔐 **Spotify Authentication Expired**

Your Spotify session has expired. Please visit:

${authUrl}

After completing authentication, return here and try your request again.`,
          },
        ],
        isError: true,
      };
    }

    console.log(
      `❌ Spotify API error for session ${sessionId}:`,
      error.message
    );
    return {
      content: [
        {
          type: "text",
          text: `❌ **Spotify API Error**

${error.message}`,
        },
      ],
      isError: true,
    };
  }
}

// Create MCP server instance with session context
function createSpotifyMcpServer(sessionId) {
  const server = new McpServer({
    name: "SpotifyServer",
    version: "1.0.0",
  });

  // Search tracks
  server.registerTool(
    "search-tracks",
    {
      title: "Search Spotify Tracks",
      description: "Search for tracks on Spotify",
      inputSchema: {
        query: z.string().describe("Search query for tracks"),
        limit: z
          .number()
          .min(1)
          .max(50)
          .default(10)
          .describe("Number of results to return"),
      },
    },
    async ({ query, limit }) => {
      return await handleSpotifyTool(sessionId, async (accessToken) => {
        const response = await fetch(
          `https://api.spotify.com/v1/search?q=${encodeURIComponent(
            query
          )}&type=track&limit=${limit}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            `Spotify API error: ${data.error?.message || "Unknown error"}`
          );
        }

        const tracks = data.tracks.items.map((track) => ({
          id: track.id,
          name: track.name,
          artist: track.artists.map((artist) => artist.name).join(", "),
          album: track.album.name,
          uri: track.uri,
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(tracks, null, 2),
            },
          ],
        };
      });
    }
  );

  // Get current user
  server.registerTool(
    "get-current-user",
    {
      title: "Get Current User",
      description: "Get current Spotify user information",
    },
    async () => {
      return await handleSpotifyTool(sessionId, async (accessToken) => {
        const response = await fetch("https://api.spotify.com/v1/me", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            `Spotify API error: ${data.error?.message || "Unknown error"}`
          );
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: data.id,
                  name: data.display_name,
                  email: data.email,
                  country: data.country,
                  followers: data.followers?.total || 0,
                },
                null,
                2
              ),
            },
          ],
        };
      });
    }
  );

  // Create playlist
  server.registerTool(
    "create-playlist",
    {
      title: "Create Playlist",
      description: "Create a new playlist on Spotify",
      inputSchema: {
        name: z.string().describe("Name of the playlist"),
        description: z
          .string()
          .optional()
          .describe("Description of the playlist"),
        public: z
          .boolean()
          .default(false)
          .describe("Whether playlist should be public"),
      },
    },
    async ({ name, description = "", public: isPublic }) => {
      return await handleSpotifyTool(sessionId, async (accessToken) => {
        // Get user ID first
        const userResponse = await fetch("https://api.spotify.com/v1/me", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        const userData = await userResponse.json();
        const userId = userData.id;

        // Create playlist
        const response = await fetch(
          `https://api.spotify.com/v1/users/${userId}/playlists`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name,
              description,
              public: isPublic,
            }),
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            `Spotify API error: ${data.error?.message || "Unknown error"}`
          );
        }

        return {
          content: [
            {
              type: "text",
              text: `✅ Playlist created successfully!\n\n**${data.name}**\nID: ${data.id}\n🔗 [Open in Spotify](${data.external_urls.spotify})`,
            },
          ],
        };
      });
    }
  );

  // Add tracks to playlist
  server.registerTool(
    "add-tracks-to-playlist",
    {
      title: "Add Tracks to Playlist",
      description: "Add tracks to an existing playlist",
      inputSchema: {
        playlistId: z.string().describe("The Spotify playlist ID"),
        trackUris: z
          .array(z.string())
          .describe("Array of Spotify track URIs to add"),
      },
    },
    async ({ playlistId, trackUris }) => {
      return await handleSpotifyTool(sessionId, async (accessToken) => {
        const response = await fetch(
          `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              uris: trackUris,
            }),
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            `Spotify API error: ${data.error?.message || "Unknown error"}`
          );
        }

        return {
          content: [
            {
              type: "text",
              text: `✅ Successfully added ${trackUris.length} track(s) to playlist!`,
            },
          ],
        };
      });
    }
  );

  // Get recommendations
  server.registerTool(
    "get-recommendations",
    {
      title: "Get Recommendations",
      description: "Get music recommendations based on seed tracks",
      inputSchema: {
        seedTracks: z
          .array(z.string())
          .max(5)
          .describe("Spotify track IDs to use as seeds (max 5)"),
        limit: z
          .number()
          .min(1)
          .max(100)
          .default(20)
          .describe("Number of recommendations to return"),
      },
    },
    async ({ seedTracks, limit }) => {
      return await handleSpotifyTool(sessionId, async (accessToken) => {
        if (seedTracks.length === 0) {
          throw new Error("At least one seed track is required");
        }

        const response = await fetch(
          `https://api.spotify.com/v1/recommendations?seed_tracks=${seedTracks.join(
            ","
          )}&limit=${limit}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            `Spotify API error: ${data.error?.message || "Unknown error"}`
          );
        }

        const tracks = data.tracks.map((track) => ({
          id: track.id,
          name: track.name,
          artist: track.artists.map((artist) => artist.name).join(", "),
          album: track.album.name,
          uri: track.uri,
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(tracks, null, 2),
            },
          ],
        };
      });
    }
  );

  return server;
}

// Express app setup
const app = express();
app.use(express.json());

// CORS configuration
app.use(
  cors({
    origin: "*",
    exposedHeaders: ["Mcp-Session-Id"],
    allowedHeaders: ["Content-Type", "mcp-session-id"],
  })
);

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    activeSessions: transports.size,
  });
});

// Simple auth landing page
app.get("/auth", (req, res) => {
  const sessionId = req.query.session;

  if (!sessionId) {
    res.status(400).send("Missing session ID");
    return;
  }

  const authUrl = getSpotifyAuthUrl(sessionId);

  res.send(`
    <html>
      <head>
        <title>Connect Spotify to Claude</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            text-align: center;
            padding: 50px;
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            margin: 0;
          }
          .container {
            background: rgba(0,0,0,0.1);
            padding: 40px;
            border-radius: 20px;
            backdrop-filter: blur(10px);
            display: inline-block;
            max-width: 500px;
          }
          .spotify-icon { font-size: 60px; margin-bottom: 20px; }
          h1 { margin: 20px 0; font-size: 28px; }
          p { font-size: 18px; line-height: 1.5; opacity: 0.9; }
          .auth-button {
            display: inline-block;
            background: #1db954;
            color: white;
            padding: 15px 30px;
            border-radius: 50px;
            text-decoration: none;
            font-size: 18px;
            font-weight: bold;
            margin: 20px 0;
            transition: all 0.3s ease;
          }
          .auth-button:hover {
            background: #1ed760;
            transform: translateY(-2px);
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="spotify-icon">🎵</div>
          <h1>Connect Spotify to Claude</h1>
          <p>Click the button below to connect your Spotify account and enable music features in Claude.</p>

          <a href="${authUrl}" class="auth-button">Connect Spotify Account</a>

          <p style="font-size: 14px; margin-top: 30px;">
            After connecting, return to Claude to use Spotify features.
          </p>
        </div>
      </body>
    </html>
  `);
});

// Spotify OAuth callback
app.get("/callback/spotify", async (req, res) => {
  const { code, state: sessionId, error } = req.query;

  if (error) {
    console.log(`❌ OAuth error: ${error}`);
    res.status(400).send(`Authentication error: ${error}`);
    return;
  }

  if (!code || !sessionId) {
    console.log(`❌ OAuth callback missing code or sessionId`);
    res.status(400).send("Missing authorization code or session ID");
    return;
  }

  console.log(`🔄 Processing OAuth callback for session: ${sessionId}`);

  try {
    const tokens = await exchangeCodeForTokens(code);
    sessionTokens.set(sessionId, tokens);
    console.log(`✅ OAuth successful for session: ${sessionId}`);

    res.send(`
      <html>
        <head>
          <title>Spotify Connected Successfully</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              text-align: center;
              padding: 50px;
              background: linear-gradient(135deg, #1db954, #1ed760);
              color: white;
              margin: 0;
            }
            .container {
              background: rgba(0,0,0,0.1);
              padding: 40px;
              border-radius: 20px;
              backdrop-filter: blur(10px);
              display: inline-block;
              max-width: 500px;
            }
            .success-icon { font-size: 60px; margin-bottom: 20px; }
            h1 { margin: 20px 0; font-size: 28px; }
            p { font-size: 18px; line-height: 1.5; opacity: 0.9; }
            .instruction {
              background: rgba(255,255,255,0.1);
              padding: 20px;
              border-radius: 10px;
              margin-top: 30px;
              border: 1px solid rgba(255,255,255,0.2);
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon">🎵</div>
            <h1>Successfully Connected to Spotify!</h1>
            <p>Your Spotify account is now linked to Claude.</p>

            <div class="instruction">
              <strong>Next Steps:</strong><br>
              1. Return to your Claude conversation<br>
              2. Try your Spotify request again<br>
              3. This window can be closed
            </div>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error(
      `❌ Token exchange failed for session ${sessionId}:`,
      error.message
    );
    res.status(500).send(`Authentication error: ${error.message}`);
  }
});

// MCP endpoint with session management
app.post("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"];
    let transport;

    if (sessionId && transports.has(sessionId)) {
      // Reuse existing transport
      transport = transports.get(sessionId);
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New initialization request
      const newSessionId = randomUUID();

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        onsessioninitialized: (sessionId) => {
          console.log(`🎯 New MCP session initialized: ${sessionId}`);
        },
      });

      // Clean up transport when closed (ONLY key change)
      transport.onclose = () => {
        if (transport.sessionId) {
          console.log(`🔌 MCP session closed: ${transport.sessionId}`);
          cleanupSession(transport.sessionId);
        }
      };

      // Create and connect server with sessionId
      const server = createSpotifyMcpServer(newSessionId);
      await server.connect(transport);

      // Store transport
      transports.set(newSessionId, transport);
    } else {
      // Invalid request
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      });
      return;
    }

    // Handle the request
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(`❌ MCP request error:`, error.message);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

// Handle GET requests for server-to-client notifications via SSE
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  const transport = transports.get(sessionId);
  await transport.handleRequest(req, res);
});

// Handle DELETE requests for session termination
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  const transport = transports.get(sessionId);
  await transport.handleRequest(req, res);

  // Clean up on explicit delete
  cleanupSession(sessionId);
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Spotify OAuth MCP Server running on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`🔗 OAuth callback: http://localhost:${PORT}/callback/spotify`);
  console.log(`📊 Mode: STATEFUL with OAuth`);
});

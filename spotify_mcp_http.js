import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import fetch from "node-fetch";

// Helper function to create server instance
function createSpotifyMcpServer() {
  const server = new McpServer({
    name: "SpotifyServer",
    version: "1.0.0",
    capabilities: {
      tools: {},
    },
  });

  let spotifyAuthInfo = {
    accessToken: "",
    refreshToken: "",
    clientId: "",
    clientSecret: "",
  };

  // Refresh token when needed
  async function getValidAccessToken() {
    if (!spotifyAuthInfo.accessToken || !spotifyAuthInfo.refreshToken) {
      throw new Error(
        "No access token available. Please set credentials first using the set-spotify-credentials tool."
      );
    }

    try {
      // Try using current token
      const response = await fetch("https://api.spotify.com/v1/me", {
        headers: {
          Authorization: `Bearer ${spotifyAuthInfo.accessToken}`,
        },
      });

      // If token works, return it
      if (response.ok) {
        return spotifyAuthInfo.accessToken;
      }

      console.log("Access token expired, refreshing...");

      // If token doesn't work, refresh it
      const refreshResponse = await fetch(
        "https://accounts.spotify.com/api/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization:
              "Basic " +
              Buffer.from(
                spotifyAuthInfo.clientId + ":" + spotifyAuthInfo.clientSecret
              ).toString("base64"),
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: spotifyAuthInfo.refreshToken,
          }),
        }
      );

      const data = await refreshResponse.json();

      if (data.access_token) {
        console.log("Successfully refreshed access token");
        spotifyAuthInfo.accessToken = data.access_token;
        return spotifyAuthInfo.accessToken;
      }

      throw new Error("Failed to refresh access token");
    } catch (error) {
      throw new Error("Error with access token: " + error.message);
    }
  }

  // Use the newer registerTool method instead of tool()
  server.registerTool(
    "set-spotify-credentials",
    {
      title: "Set Spotify Credentials",
      description: "Set your Spotify authentication credentials",
      inputSchema: {
        clientId: z.string().describe("The Spotify Client ID"),
        clientSecret: z.string().describe("The Spotify Client Secret"),
        accessToken: z.string().describe("The Spotify Access Token"),
        refreshToken: z.string().describe("The Spotify Refresh Token"),
      },
    },
    async ({ clientId, clientSecret, accessToken, refreshToken }) => {
      spotifyAuthInfo.clientId = clientId;
      spotifyAuthInfo.clientSecret = clientSecret;
      spotifyAuthInfo.accessToken = accessToken;
      spotifyAuthInfo.refreshToken = refreshToken;

      return {
        content: [
          {
            type: "text",
            text: "Spotify credentials set successfully. You can now use other Spotify tools.",
          },
        ],
      };
    }
  );

  // Check credentials tool
  server.registerTool(
    "check-credentials-status",
    {
      title: "Check Credentials Status",
      description: "Check if your Spotify credentials are valid",
      inputSchema: {},
    },
    async () => {
      console.log("Checking Spotify credentials status...");
      if (
        !spotifyAuthInfo.accessToken ||
        !spotifyAuthInfo.refreshToken ||
        !spotifyAuthInfo.clientId ||
        !spotifyAuthInfo.clientSecret
      ) {
        return {
          content: [
            {
              type: "text",
              text: "Spotify credentials are not set. Please use the set-spotify-credentials tool.",
            },
          ],
        };
      }

      try {
        const accessToken = await getValidAccessToken();

        const response = await fetch("https://api.spotify.com/v1/me", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (response.ok) {
          const userData = await response.json();
          return {
            content: [
              {
                type: "text",
                text: `Spotify credentials are valid.\nLogged in as: ${
                  userData.display_name
                } (${userData.email || "email not available"})`,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: `Spotify credentials may be invalid. Status code: ${response.status}`,
              },
            ],
            isError: true,
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error checking credentials: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Search tracks
  server.registerTool(
    "search-tracks",
    {
      title: "Search Tracks",
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
      try {
        const accessToken = await getValidAccessToken();

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
          return {
            content: [
              {
                type: "text",
                text: `Error searching tracks: ${JSON.stringify(data)}`,
              },
            ],
            isError: true,
          };
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
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to search tracks: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Get current user
  server.registerTool(
    "get-current-user",
    {
      title: "Get Current User",
      description: "Get your Spotify profile information",
      inputSchema: {},
    },
    async () => {
      try {
        const accessToken = await getValidAccessToken();

        const response = await fetch("https://api.spotify.com/v1/me", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        const data = await response.json();

        if (!response.ok) {
          return {
            content: [
              {
                type: "text",
                text: `Error getting user profile: ${JSON.stringify(data)}`,
              },
            ],
            isError: true,
          };
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get user profile: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Create playlist
  server.registerTool(
    "create-playlist",
    {
      title: "Create Playlist",
      description: "Create a new playlist on your Spotify account",
      inputSchema: {
        name: z.string().describe("Name of the playlist"),
        description: z
          .string()
          .optional()
          .describe("Description of the playlist"),
      },
    },
    async ({ name, description = "" }) => {
      try {
        const accessToken = await getValidAccessToken();

        // Get user ID
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
              public: false,
            }),
          }
        );

        const data = await response.json();

        if (!response.ok) {
          return {
            content: [
              {
                type: "text",
                text: `Error creating playlist: ${JSON.stringify(data)}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Playlist created successfully!\nName: ${data.name}\nID: ${data.id}\nURL: ${data.external_urls.spotify}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to create playlist: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
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
      try {
        const accessToken = await getValidAccessToken();

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
          return {
            content: [
              {
                type: "text",
                text: `Error adding tracks: ${JSON.stringify(data)}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Successfully added ${trackUris.length} track(s) to playlist!`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to add tracks: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
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
      try {
        const accessToken = await getValidAccessToken();

        if (seedTracks.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "Error: At least one seed track is required",
              },
            ],
            isError: true,
          };
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
          return {
            content: [
              {
                type: "text",
                text: `Error getting recommendations: ${JSON.stringify(data)}`,
              },
            ],
            isError: true,
          };
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
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get recommendations: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}

// Create Express app
const app = express();

// Increase JSON payload limit for large requests
app.use(express.json({ limit: "10mb" }));

// CORS configuration - more permissive for development
app.use(
  cors({
    origin: true, // Allow all origins in development
    credentials: true,
    exposedHeaders: ["Mcp-Session-Id"],
    allowedHeaders: ["Content-Type", "mcp-session-id", "Authorization"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "Spotify MCP Server",
  });
});

// Add some debugging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  if (req.method === "POST" && req.path === "/mcp") {
    console.log("MCP Request body:", JSON.stringify(req.body, null, 2));
  }
  next();
});

// MCP endpoint (stateless mode)
app.post("/mcp", async (req, res) => {
  console.log("Handling MCP request...");

  try {
    // Create new server instance for each request (stateless)
    const server = createSpotifyMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // No session management for stateless mode
    });

    // Set up cleanup
    const cleanup = () => {
      console.log("Cleaning up server and transport");
      try {
        transport.close();
        server.close();
      } catch (err) {
        console.error("Error during cleanup:", err);
      }
    };

    // Clean up when request closes
    res.on("close", cleanup);
    res.on("error", cleanup);

    // Connect server to transport
    await server.connect(transport);
    console.log("Server connected to transport");

    // Handle the request
    await transport.handleRequest(req, res, req.body);
    console.log("Request handled successfully");
  } catch (error) {
    console.error("Error handling MCP request:", error);
    console.error("Stack trace:", error.stack);

    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
          data:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        },
        id: null,
      });
    }
  }
});

// Handle preflight OPTIONS requests
app.options("/mcp", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Content-Length, X-Requested-With, mcp-session-id"
  );
  res.sendStatus(200);
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Express error:", error);
  res.status(500).json({
    error: "Internal Server Error",
    message:
      process.env.NODE_ENV === "development"
        ? error.message
        : "Something went wrong",
  });
});

// Handle 404s
app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Spotify MCP Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`Mode: STATELESS`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
});

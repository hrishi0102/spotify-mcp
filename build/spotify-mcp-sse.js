import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import fetch from "node-fetch";
import express from "express";
import cors from "cors";
const app = express();
app.use(cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
}));
const server = new McpServer({
    name: "SpotifyServer",
    version: "1.0.0",
    capabilities: {
        tools: {},
    },
});
const transports = {};
let spotifyAuthInfo = {
    accessToken: "",
    refreshToken: "",
    clientId: "",
    clientSecret: "",
};
// Refresh token when needed
async function getValidAccessToken() {
    if (!spotifyAuthInfo.accessToken || !spotifyAuthInfo.refreshToken) {
        throw new Error("No access token available. Please set credentials first using the set-spotify-credentials tool.");
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
        console.error("Access token expired, refreshing...");
        // If token doesn't work, refresh it
        const refreshResponse = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization: "Basic " +
                    Buffer.from(spotifyAuthInfo.clientId + ":" + spotifyAuthInfo.clientSecret).toString("base64"),
            },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: spotifyAuthInfo.refreshToken,
            }),
        });
        const data = (await refreshResponse.json());
        if (data.access_token) {
            console.error("Successfully refreshed access token");
            spotifyAuthInfo.accessToken = data.access_token;
            return spotifyAuthInfo.accessToken;
        }
        throw new Error("Failed to refresh access token");
    }
    catch (error) {
        throw new Error("Error with access token: " +
            (error instanceof Error ? error.message : String(error)));
    }
}
// Set credentials tool
server.tool("set-spotify-credentials", {
    clientId: z.string().describe("The Spotify Client ID"),
    clientSecret: z.string().describe("The Spotify Client Secret"),
    accessToken: z.string().describe("The Spotify Access Token"),
    refreshToken: z.string().describe("The Spotify Refresh Token"),
}, async ({ clientId, clientSecret, accessToken, refreshToken }) => {
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
});
// Check credentials tool
server.tool("check-credentials-status", {}, async () => {
    if (!spotifyAuthInfo.accessToken ||
        !spotifyAuthInfo.refreshToken ||
        !spotifyAuthInfo.clientId ||
        !spotifyAuthInfo.clientSecret) {
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
            const userData = (await response.json());
            return {
                content: [
                    {
                        type: "text",
                        text: `Spotify credentials are valid.\nLogged in as: ${userData.display_name} (${userData.email || "email not available"})`,
                    },
                ],
            };
        }
        else {
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
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error checking credentials: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
            isError: true,
        };
    }
});
// Search tracks
server.tool("search-tracks", {
    query: z.string().describe("Search query for tracks"),
    limit: z
        .number()
        .min(1)
        .max(50)
        .default(10)
        .describe("Number of results to return"),
}, async ({ query, limit }) => {
    try {
        const accessToken = await getValidAccessToken();
        const response = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        const data = (await response.json());
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
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Failed to search tracks: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
            isError: true,
        };
    }
});
// Get current user
server.tool("get-current-user", {}, async () => {
    try {
        const accessToken = await getValidAccessToken();
        const response = await fetch("https://api.spotify.com/v1/me", {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        const data = (await response.json());
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
                    text: JSON.stringify({
                        id: data.id,
                        name: data.display_name,
                        email: data.email,
                        country: data.country,
                    }, null, 2),
                },
            ],
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Failed to get user profile: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
            isError: true,
        };
    }
});
// Create playlist
server.tool("create-playlist", {
    name: z.string().describe("Name of the playlist"),
    description: z.string().optional().describe("Description of the playlist"),
}, async ({ name, description = "" }) => {
    try {
        const accessToken = await getValidAccessToken();
        // Get user ID
        const userResponse = await fetch("https://api.spotify.com/v1/me", {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        const userData = (await userResponse.json());
        const userId = userData.id;
        // Create playlist
        const response = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
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
        });
        const data = (await response.json());
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
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Failed to create playlist: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
            isError: true,
        };
    }
});
// Add tracks to playlist
server.tool("add-tracks-to-playlist", {
    playlistId: z.string().describe("The Spotify playlist ID"),
    trackUris: z
        .array(z.string())
        .describe("Array of Spotify track URIs to add"),
}, async ({ playlistId, trackUris }) => {
    try {
        const accessToken = await getValidAccessToken();
        const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                uris: trackUris,
            }),
        });
        const data = (await response.json());
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
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Failed to add tracks: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
            isError: true,
        };
    }
});
// Get recommendations
server.tool("get-recommendations", {
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
}, async ({ seedTracks, limit }) => {
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
        const response = await fetch(`https://api.spotify.com/v1/recommendations?seed_tracks=${seedTracks.join(",")}&limit=${limit}`, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        const data = (await response.json());
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
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Failed to get recommendations: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
            isError: true,
        };
    }
});
let transport = null;
app.get("/sse", (req, res) => {
    transport = new SSEServerTransport("/messages", res);
    server.connect(transport);
});
app.post("/messages", (req, res) => {
    if (transport) {
        transport.handlePostMessage(req, res);
    }
    else {
        res.status(503).send("No active transport");
    }
});
app.listen(3001, () => {
    console.log("Listening on port 3001");
});

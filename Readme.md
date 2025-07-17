[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/hrishi0102-spotifyyy-mcp-badge.png)](https://mseep.ai/app/hrishi0102-spotifyyy-mcp)

# Spotify MCP Server

A simple Model Context Protocol (MCP) server that lets you interact with Spotify through Claude. This server enables Claude to search for songs, create playlists, get recommendations, and more using your Spotify account.

## Features

- Search for tracks on Spotify
- View your Spotify profile
- Create playlists
- Add tracks to playlists
- Get personalized music recommendations

## Tools Available

| Tool Name                  | Description                                              |
| -------------------------- | -------------------------------------------------------- |
| `set-spotify-credentials`  | Set your Spotify authentication credentials              |
| `check-credentials-status` | Check if your credentials are valid and who is logged in |
| `search-tracks`            | Search for tracks by name, artist, or keywords           |
| `get-current-user`         | Get your Spotify profile information                     |
| `create-playlist`          | Create a new playlist on your account                    |
| `add-tracks-to-playlist`   | Add tracks to an existing playlist                       |
| `get-recommendations`      | Get recommendations based on seed tracks                 |

## Setup Instructions

### 1. Prerequisites

- Node.js v16 or higher
- npm
- A Spotify account
- A registered Spotify Developer application

### 2. Create a Spotify Developer App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/)
2. Log in with your Spotify account
3. Click "Create an App"
4. Fill in the app name and description
5. Add `http://localhost:8888/callback` as a Redirect URI
6. Note your Client ID and Client Secret

### 3. Install the Project

```bash
# Clone or download the project first
cd spotify-mcp-server

# Install dependencies
npm install
```

### 4. Get Your Spotify Tokens

Edit the `spotify-auth.js` file to include your Client ID and Client Secret:

```javascript
// Replace these with your Spotify app credentials
const CLIENT_ID = "your_client_id_here";
const CLIENT_SECRET = "your_client_secret_here";
```

Then run the authentication script:

```bash
node spotify-auth.js
```

This will:

1. Open a URL in your browser
2. Prompt you to log in to Spotify
3. Ask for your permission to access your account
4. Save the tokens to `secrets.json`

### 5. Build the MCP Server

```bash
npm run build
```

### 6. Configure Claude Desktop

Edit your Claude Desktop configuration file:

- On macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- On Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add the following configuration:

```json
{
  "mcpServers": {
    "spotify": {
      "command": "node",
      "args": ["/full/path/to/spotify-mcp-server/build/spotify-mcp-server.js"]
    }
  }
}
```

Replace `/full/path/to/spotify-mcp-server` with the actual path to your project directory.

### 7. Restart Claude Desktop

Close and reopen Claude Desktop to load the new configuration.

## Usage

When you start a conversation with Claude, you'll first need to set your Spotify credentials:

1. Look at your `secrets.json` file to get your credentials
2. Use the `set-spotify-credentials` tool to authenticate
3. Then use any of the other Spotify tools

## Example Prompts

### Setting Up Credentials

```
I want to connect to my Spotify account. Here are my credentials from secrets.json:

Tool: set-spotify-credentials
Parameters:
{
  "clientId": "your_client_id",
  "clientSecret": "your_client_secret",
  "accessToken": "your_access_token",
  "refreshToken": "your_refresh_token"
}
```

### Basic Commands

Check your account:

```
Can you check who I'm logged in as on Spotify?

Tool: get-current-user
Parameters: {}
```

Search for tracks:

```
Search for songs by Weekend

Tool: search-tracks
Parameters:
{
  "query": "Taylor Swift",
  "limit": 5
}
```

Create a playlist:

```
Create a new playlist called "My Pretty pretty girlfriend"

Tool: create-playlist
Parameters:
{
  "name": "My Pretty pretty girlfriend",
  "description": "For my girlfriend. Created with Claude and the Spotify MCP server"
}
```

### Multi-Step Tasks

Creating a playlist with songs:

```
I want to create a workout playlist with energetic songs. First, search for some high-energy songs. Then create a playlist called "Workout Mix" and add those songs to it.
```

Getting recommendations based on favorites:

```
I like the song "Blinding Lights" by The Weeknd. Can you search for it, then find similar songs, and create a playlist with those recommendations?
```

## Troubleshooting

- **Error: No access token available**: You need to set your credentials first using the `set-spotify-credentials` tool
- **Authentication failures**: Your tokens may have expired. Run the auth script again to get fresh tokens
- **Invalid credentials**: Double check that you're using the correct Client ID and Client Secret

## Notes

- The server stores credentials in memory only
- You'll need to set credentials each time you start a new conversation
- If Claude Desktop restarts, you'll need to set credentials again

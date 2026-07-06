# Study Adventure Mission Console

## Quick Start

1. Install Node.js LTS from https://nodejs.org/.
2. Install Ollama from https://ollama.com/.
3. In Ollama, install the local DM model you want to use.
   - Recommended: `ollama pull qwen3.5:9b`
   - Lighter fallback: `ollama pull llama3.2:3b`
4. Double-click `start-study-adventure.bat`.
5. The launcher starts the local server and opens the teacher page:
   - `http://localhost:4174/index.html`

## Temporary Cloudflare Link

For friends or phones that cannot reach your laptop over Wi-Fi, double-click:

```text
start-study-adventure-cloudflare.bat
```

This starts the local game server and a temporary Cloudflare tunnel together. The window will print a public `trycloudflare.com` teacher link and player link. Keep that window open while the game is running. Closing it, or running `stop-study-adventure.bat`, stops the tunnel and the game server started by that launcher.

## Player Devices

Player page:

- `http://localhost:4174/player.html`

For phones or other devices, they must be able to reach the laptop running the server. The app will show a room code and QR code during the multi-device lobby. If school Wi-Fi blocks device-to-device traffic, use the laptop hotspot or run the game in Single Device mode.

## Manual Start

If you prefer Command Prompt or PowerShell:

```powershell
cd "C:\path\to\study-adventure"
node server.js
```

Then open:

```text
http://localhost:4174/
```

## Stopping The Game

Double-click `stop-study-adventure.bat`.

If the server was started manually, close the command window or press `Ctrl+C` in the window running `node server.js`.

## Notes

- No `npm install` is required.
- Saved question sets are stored in the browser's local storage on the teacher computer.
- Ollama must be running for Local Auto DM narration.

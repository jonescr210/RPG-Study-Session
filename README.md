# RPG Study Session

A classroom study game that turns review questions into a text-based adventure with a live mission map, player devices, timed challenges, local AI narration, and survival-style team status.

## What It Does

- Runs a teacher mission console in the browser.
- Lets students join from phones or laptops with a room code or QR code.
- Supports single-device and multi-device play.
- Turns pasted multiple-choice, true/false, and fill-in-the-blank questions into mission encounters.
- Tracks player HP, status effects, inventory, mission progress, and room outcomes.
- Uses local AI narration through Ollama or LM Studio when available.
- Includes optional text-to-speech support and temporary Cloudflare tunnel support for remote/mobile joins.

## Why I Built It

This project was built to make classroom review sessions feel more active than a standard quiz. The goal is to keep students answering study questions while wrapping those questions in a fast-paced cooperative mission.

## Quick Start

1. Install Node.js LTS.
2. Clone or download this repo.
3. Double-click `start-study-adventure.bat`.
4. Open the teacher page:

```text
http://localhost:4174/index.html
```

Player page:

```text
http://localhost:4174/player.html
```

More detailed setup notes are in `RUN_GAME.md`.

## Local AI Narration

The game can run with baked-in fallback narration, but it is designed to work best with a local model through:

- Ollama
- LM Studio

The local model creates mission briefings, room descriptions, consequences, action results, and boss-style encounters.

## Project Structure

- `index.html` - Teacher mission console.
- `player.html` - Student/player device page.
- `app.js` - Main game flow and UI orchestration.
- `dashboard-optional.js` - Lazy-loaded simulator, item overlay, and debug-console rendering.
- `server.js` - Local HTTP server and API endpoints.
- `player.js` - Player device behavior.
- `styles.css` - Authoritative shared UI stylesheet source.
- `dashboard.css` / `player.css` - Generated runtime stylesheets for the teacher and player screens.
- `build-ui-css.js` - Rebuilds the two runtime stylesheets after `styles.css` changes (`node build-ui-css.js`).
- `question-bank.js` - Question parsing and demo question support.
- `local-dm-prompts.js` - Prompt builders for local AI narration.
- `action-rooms.js` - Action-driven room types and room entity helpers.
- `tts-manager.js` - Browser, Piper, and Kokoro text-to-speech manager.
- `kokoro-worker.py` - Keeps the local Kokoro voice model loaded between narration requests.
- `shared-data.js` - Shared names, action banks, and profanity filtering.
- `TRANSFER_SUMMARY.md` - Current development handoff, architecture notes, known risks, and next implementation steps.

## Notes

### Optional Kokoro narration

Kokoro provides higher-quality local narration than the browser voice while remaining fully offline. Run `setup-kokoro-tts.ps1` from PowerShell once, restart the Study Adventure server, then select **Local Kokoro** and a voice on the setup screen. The downloaded runtime and model are stored under `tts/kokoro/` and are intentionally excluded from Git because they use roughly 700 MB on disk.

This is a local-first classroom tool. Runtime files such as logs, saved question sets, local voice models, checkpoints, and generated session data are ignored by Git so the repo stays clean for portfolio use.

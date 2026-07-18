# Study Adventure - New Chat Transfer

Updated: 2026-07-18

## Start Here

- Workspace: `C:\Users\jones\Documents\Codex\2026-05-29\so-i-want-to-create-a`
- Branch: `main`
- Teacher dashboard: `http://localhost:4174/index.html`
- Player screen: `http://localhost:4174/player.html`
- Start locally with `start-study-adventure.bat`.
- Before editing, run `git status --short` and preserve any user changes.

## Current Game

Study Adventure is a classroom study game presented as a survival mission. The teacher runs the main mission console while players answer and use class/item abilities from their own devices or through local teacher mode.

The current build includes:

- Individual study challenges in obstacle and combat rooms.
- Six player classes, class abilities, two-slot inventories, item drops, rarity, XP, leveling, and boss rewards.
- Light, medium, and heavy enemies with image-based visuals.
- Mid-boss and final-boss encounters with separate red and green eye visuals and intro videos.
- A redesigned three-column mission dashboard, initiative timeline, live mission log, status feed, simulator controls, and responsive player UI.
- Two mission themes: Decayed Bunker and Abandoned Space Station.
- Local and multi-device play, simulated players, narration/TTS, music, and sound effects.

## Important Recent Work

- Replaced the old dashboard with the new live mission-console design.
- Added image enemies and theme-specific normal-combat backgrounds.
- Re-enabled the lightweight map marker animation using transform-only movement.
- Sequenced dashboard boot panels so the center screen appears first, followed by the remaining center, left, and right panels.
- Prevented the mission log from creating intermittent horizontal scrollbars while typewriter text is rendering.
- Corrected boss audio timing:
  - `boss.wav` is the readiness-check mood sting.
  - Existing music fades when the readiness gate is actually reached.
  - The sting waits until the previous combat screen is gone and map travel is complete.
  - `boss_music.mp3` begins with the boss fight prompt, not during readiness.

## Key Files

- `app.js` - mission state, combat, progression, dashboard rendering, audio, multiplayer orchestration.
- `styles.css` - shared setup, player, combat, map, and animation styles.
- `mission-console-live.css` - current live dashboard layout and visual overrides.
- `index.html` - teacher setup and mission dashboard markup.
- `player.html` / `player.js` - responsive player device interface.
- `server.js` - local static server and player-session APIs.
- `tts-manager.js` - narration playback and TTS coordination.
- `audio-effects.json` - sound-effect associations.
- `assets/` and `enemy_assets/` - boss, enemy, and environment art/video sources.

## Validation

After JavaScript changes, run:

```powershell
node --check app.js
node --check player.js
node --check server.js
node --check tts-manager.js
git diff --check
```

For live testing, refresh the teacher and player pages so the latest cache-versioned assets load. Avoid resetting or navigating away from an active user test unless asked.

## Next Useful Test

Run a mission that ends a normal combat immediately before a boss room. Verify this order:

1. The previous combat finishes all animations and fades away.
2. The map marker travels to the boss room.
3. Existing music fades out and `boss.wav` begins at the readiness gate.
4. The boss fight starts only after Continue/critical contact.
5. `boss_music.mp3` starts with the first boss question.

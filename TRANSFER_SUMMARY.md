# Study Adventure Transfer Summary

Updated: 2026-07-14

## New Chat: Start Here

This document is the handoff for the current Study Adventure implementation.

Before making changes:

1. Work from `C:\Users\jones\Documents\Codex\2026-05-29\so-i-want-to-create-a`.
2. Read `git status --short` and inspect relevant diffs. The working tree contains substantial valid, uncommitted work.
3. Do not discard, reset, or overwrite unrelated changes.
4. Do not reload, navigate, or reset an active browser session unless the user explicitly asks. File-only checks are preferred while a game is running.
5. Use `apply_patch` for manual edits.
6. Run `node --check` on edited JavaScript and `git diff --check` before finishing.

The latest code changes are present on disk but are not necessarily loaded into an already-open browser session. They take effect after the user intentionally reloads or starts a new session.

## Project Goal

Study Adventure is a classroom review game presented as a survival mission. A teacher runs a projector-friendly mission console, while students can answer from the teacher screen or join from phones and laptops. Study questions are integrated into AI-generated mission narration, a visual route map, timed challenges, boss encounters, player status, sound, music, and text-to-speech.

The experience should feel like a mission first and a quiz second. Story output must stay coherent, preserve the persistent threat, translate answers into physical in-world actions, and never expose hidden rolls or internal mechanics to players.

## Repository and Git

- Branch: `main`
- Remote: `https://github.com/jonescr210/RPG-Study-Session.git`
- Last committed revision at handoff: `9814842 Add immersive mission dashboard and audio system`
- The current working tree has many changes after that commit.

Modified at handoff:

- `.gitignore`
- `README.md`
- `app.js`
- `index.html`
- `player.html`
- `player.js`
- `question-bank.js`
- `server.js`
- `styles.css`
- `tts-manager.js`

Untracked at handoff:

- `audio-effects/boss_music.mp3`
- `audio-effects/normal_music.mp3`
- `kokoro-worker.py`
- `setup-kokoro-tts.ps1`
- This transfer document

Do not assume Git contains the latest playable build until these changes are reviewed and committed.

## Starting the App

Local server:

```text
start-study-adventure.bat
```

Teacher page:

```text
http://localhost:4174/index.html
```

Player page:

```text
http://localhost:4174/player.html
```

The local launcher stops an existing listener on port 4174, starts `server.js`, writes logs under `logs/`, prints the teacher URL, and exits. It currently does not open the browser automatically.

Temporary public access:

```text
start-study-adventure-cloudflare.bat
```

This starts the server and a temporary `trycloudflare.com` tunnel. The PowerShell launcher prints and copies the public URL, checks tunnel health, and stays open. The temporary hostname changes on restart.

Stop local services with:

```text
stop-study-adventure.bat
```

No npm dependencies or `npm install` are currently required.

## Runtime Dependencies

- Node.js for `server.js`.
- Optional Ollama at `http://localhost:11434`.
- Optional LM Studio at `http://127.0.0.1:1234`.
- Optional Piper runtime and voice under `tts/`.
- Optional Kokoro runtime installed by `setup-kokoro-tts.ps1`.
- Optional `cloudflared` for public device access.

Known launcher caveat: `start-study-adventure-cloudflare.bat` currently sets placeholder Piper paths named `voice-name.onnx`. Review those lines before relying on Piper through that launcher.

## Main Files

- `index.html`: teacher setup, lobby, loading sequence, mission dashboard, drawers, audio controls, debug tools.
- `styles.css`: setup and dashboard layout, responsive behavior, animations, map effects, boss/failure visuals, player states.
- `app.js`: primary state object, setup, mission flow, map, scoring, multiplayer orchestration, narration requests, audio, TTS coordination, and rendering.
- `player.html` and `player.js`: phone/laptop join screen, answers, actions, HP/status, timer, haptics, and player visual feedback.
- `server.js`: static server, multiplayer state, persistence, local-model proxies, TTS generation, host/Cloudflare URL handling.
- `question-bank.js`: demo bank and parsers for multiple choice, authored true/false, fill-in-the-blank, and difficulty labels.
- `local-dm-prompts.js`: shared local-narrator prompt helpers.
- `action-rooms.js`: action-driven room types, entity defaults, and action banks.
- `player-session.js`: player-session helpers.
- `shared-data.js`: shared action/name data and profanity substitutions.
- `tts-manager.js`: browser, Piper, and Kokoro narration playback, prefetch, and presentation-start timing.
- `audio-effects.json`: selectable sound-effect manifest.
- `RUN_GAME.md`: runtime guide. Some launcher wording may lag behind actual behavior.

## Core Game State

The main state object is near the top of `app.js`. Important fields include:

- `questions`, `players`, `inventory`
- `currentQuestion`, `currentNode`, `nodes`
- `roomNames`, `mapPositions`, `mapLayoutSeed`, `mapRevealedNodes`
- `challengeTypes`, `nodeResults`, `encounter`
- `threat`, `threatProfile`, `activeObstacles`
- `bossAreaNames`, `bossPhasePlans`, `bossReadyChecks`
- `playerPromptId`, required responders, and player answers
- `actionRooms`, action turn order, action resolution queue, room entities, and threat pressure
- timer, transition, TTS, music, and sound-effect state

New mission players currently begin as:

```js
{ name, hp: 5, status: [], incapacitated: false, points: 0 }
```

Shared inventory begins with two Medkits and zero EMS devices.

## Standard Study Mission Flow

High-level flow:

1. Parse setup questions and players.
2. Generate or load the mission title, environment, persistent threat, briefing, and boss names.
3. Build randomized challenge types and map nodes.
4. Run the deployment/loading sequence and ready check.
5. Generate and display the current encounter narration.
6. Reveal the question on the map after the narration and Query Incoming sequence.
7. Collect required answers using a unique prompt ID.
8. Stop the timer after the required submissions arrive.
9. Resolve correctness, damage, statuses, points, loot, and second wind in app code.
10. Ask the local model to narrate only the app-decided result.
11. Show status updates after narration so outcomes are not spoiled.
12. Wait for Continue or auto-continue, then animate the route transition.
13. Reveal and generate the next room.

Normal challenge types are randomized with anti-repeat weighting:

- Individual
- Team
- Locked Operator
- Emergency Response
- Authored True/False

The game no longer converts arbitrary multiple-choice questions into true/false. True/false should be authored in the source bank.

## Boss and Recovery Structure

Constants in `app.js` currently define:

- Two-boss threshold: 18 questions
- Midpoint boss: 4 questions total
- Final boss: 6 questions total
- Route travel animation: 4600 ms

Boss encounters use multiple individual steps followed by a team breakthrough. They have readiness checks, a shared encounter plan, persistent music/eyes/atmosphere, and should remain in the same room until the full sequence is complete.

Recovery rooms pause progression until a recovery option is selected. A Continue control follows the recovery resolution before the route advances.

## Question Parsing and Difficulty

Supported formats:

- Multiple choice with labeled choices and `Correct Answer:`.
- Fill in the blank with an authored underscore run and short answer.
- Authored true/false with `Correct Answer: True` or `False`.
- Optional `Difficulty: Easy`, `Difficulty: Medium`, or `Difficulty: Hard` immediately before each question.

Unlabeled questions default to medium.

Question selection is randomized. Hard questions are reserved for boss encounters when possible; easy and medium are used for ordinary encounters.

Latest parser fix:

- `question-bank.js` previously removed every underscore as Markdown.
- It now protects underscore runs of three or more, strips Markdown, then restores the question blank as `____`.
- `displayQuestionText()` also provides a defensive blank for older fill records that already lost the underscores.
- Parser checks were run against fill questions and Markdown-wrapped NotebookLM output.

## Multi-Device Logic

The teacher creates a room code. Players join through `/api/player-join` and retain their player ID, name, and room code in browser local storage.

The server exposes session and answer endpoints including:

- `/api/player-session`
- `/api/player-join`
- `/api/player-remove`
- `/api/player-answers`
- `/api/player-answer`
- `/api/player-action`
- `/api/player-action-consume`

Every question must have a fresh prompt ID. Required responder IDs/names are locked for that prompt. Server and client checks must reject stale submissions from old prompt IDs. Incapacitated players cannot answer.

Important regression area: this code previously allowed stale or premature answers to leak between questions, especially after side actions. Preserve prompt-ID checks, clear previous answers before publishing a new prompt, and do not publish the same question twice.

Team challenges wait for all required active players. Locked Operator accepts only the selected operator. Emergency Response accepts the first valid answer. Single-device individual/emergency damage can target a random active player because individual devices are unavailable.

## Timers

- Standard timer options include 30, 60, and 90 seconds; current setup default is 60 seconds.
- Emergency Response always uses 10 seconds.
- Boss sequences use their own larger shared time window.
- Recovery rooms do not run a question timer.
- The timer does not begin until the question is actually presented and answer controls are ready.
- Timer audio begins at 10 seconds remaining and stops when the question resolves.
- Teacher pause/resume is published to player devices.

## Player Status and Scoring

- Maximum HP is 5.
- Statuses include Burned, Bleeding, Shocked, and Concussed.
- Medkits heal, clear statuses, or revive.
- EMS is armed before an encounter and absorbs that encounter's damage/status effects.
- Optional Second Wind can save the last active operator once; their next answer must be correct.
- Player points reward faster correct answers and use difficulty multipliers: easy 1x, medium 1.5x, hard 2x.
- Points currently display but are reserved for deeper story effects later.

## Action-Driven Mode

Action-driven missions replace study questions with player actions. Default mission length is five rooms.

Intended pipeline:

1. App sends mission data for the opening narrative.
2. App requests structured room generation before Alert is shown.
3. Model returns room name, objective, win condition, entities, hazards, NPCs, enemies, routes, and searchable objects.
4. App sends selected room details for player-facing room description.
5. Players submit actions.
6. Model parses actor/action/target and judges sense, usefulness, risk, score, and entity effects as JSON.
7. App applies the D10 roll, safety overrides, HP, statuses, pressure, entity HP, uses, rewards, and room progress.
8. App sends only relevant resolved facts for short narration.
9. Actions resolve sequentially in randomized turn order with Continue gates.
10. Room finalization runs after the last action; turn order rotates after a full round.

The app, not the model, owns all mechanics. The model judges intent and writes narration. It must not decide final HP, inventory totals, room progress, or whether an item is actually awarded.

Room entities can be objects, hazards, routes, NPCs, or enemies. App-owned fields include IDs, tags, state, uses, HP, armor, pressure, mitigation, progress, threshold, vulnerabilities, engagement, exhaustion, and neutralization.

Existing action rewards:

- Medical searches can award one or two shared Medkits.
- Searchable supply sources can award a one-use improvised combat bonus.
- `applyRoomEntityOutcome()` consumes that bonus when a successful enemy attack deals damage.

This existing temporary bonus is the natural bridge to the proposed equipment system.

## Local AI Narration

Providers:

- Ollama
- LM Studio OpenAI-compatible API

The setup model dropdown queries the selected provider and chooses a loaded model when possible. LM Studio model-loading confirmation exists when the selected model is not already loaded.

The server serializes model calls to avoid overlapping requests. Prompts are purpose-specific: briefing, situation, room generation, room narration, answer consequence, action judgment, action narration, transitions, boss plans, and endings.

Debug tools show request timing, model responses, room JSON/entities, action judgment prompts/responses, narration prompts/responses, and mission-log history.

Important narration rule: the model receives app-decided facts and should not restate mechanics, scores, uses remaining, HP math, or generic injury-cause boilerplate. The app sanitizes obvious reasoning/meta output, but the broad safe-local-narration filter was disabled because it was incorrectly replacing valid model prose.

## TTS and Audio

Narration providers:

- Browser speech synthesis
- Local Piper
- Local Kokoro

The setup screen selects provider and voice. TTS can prefetch narration/question audio, report when playback really starts, and delay the typewriter to improve synchronization.

The opening Piper/Kokoro generation path shows the same Receiving Transmission waveform used elsewhere. It remains until the clip is ready, then fades into the typewriter.

Speech cleanup removes mission UI phrases such as `Receiving Transmission`, `Receiving Comm`, and related variants before TTS.

Audio behavior:

- `audio-effects.json` maps event IDs to custom files.
- Local normal music defaults to `audio-effects/normal_music.mp3`.
- Local boss music defaults to `audio-effects/boss_music.mp3`.
- YouTube normal/boss music is optional and remembered.
- Intro/deployment, question, submitted, correct, incorrect, damage, loot, emergency, transition, boss, ending, failure, and UI cues are wired.
- Music and local sound effects duck during TTS.
- Local HTML audio also receives a Web Audio low-pass filter during narration.
- YouTube can only volume-duck because cross-origin iframe audio cannot be routed through the local Web Audio filter.

Latest low-pass change:

- Filter activation ramps to 1800 Hz over 0.34 seconds.
- Filter release ramps back to 22000 Hz over 1.4 seconds.
- Repeated volume updates no longer restart an identical filter transition.

## Dashboard and Map

The teacher dashboard is a dark military/science-fiction console designed for projection. It includes staged panel boot animations, mission log and status waveforms, audio-reactive atmosphere, map static, boss eyes, EMS effects, damage impacts, failure visuals, question overlays, and collapsible control drawers.

Map positions are generated as a randomized sprawling route and stored in `state.mapPositions`.

Latest map discovery change:

- The full route is no longer drawn at mission start.
- Only reached rooms remain visible.
- The next room and connecting route appear during the real room transition.
- Newly discovered rooms scale/fade into view.
- Hidden rooms have no placeholder circle, question mark, name, or route line.
- State tracks first reveals with `mapRevealedNodes` so known rooms should not replay the discovery animation on every render.

The latest map/audio/parser changes passed `node --check` and `git diff --check`. They were not browser-tested because the user asked that the current live session not be reset.

## Persistence

Browser local storage keeps UI choices, player identity, selected model, audio settings, text size, fast mode, and fallback copies of saved sets/presets.

Server files persist:

- `question-sets.json`
- `music-presets.json`

These runtime files are intentionally ignored by Git.

## Next Feature: Simple Player Equipment

The user wants to inspect and then implement a simple equipment system after the map/audio fixes.

Recommended first version:

- Maximum two equipped items per player.
- Three item classes: Weapon, Tool, Armor.
- Limited charges; no weight, currency, crafting, rarity tiers, or large stat sheet yet.
- Equipment is app-owned. The model only narrates applied outcomes.

Suggested item shape:

```js
{
  id: "field-cutter",
  label: "Field Cutter",
  slot: "tool",
  charges: 2,
  maxCharges: 2,
  effect: {
    kind: "action-score",
    amount: 1,
    categories: ["repair", "bypass"]
  }
}
```

Suggested initial effects:

- Weapon: add one enemy damage on a successful direct attack, then consume one charge.
- Tool: add one action score when its categories/tags match, then consume one charge.
- Armor: reduce the next non-bleed damage by one, then consume one charge.

Implementation path:

1. Add `equipment: []` when players are created.
2. Put item definitions and pure matching helpers in a new `equipment.js` module rather than expanding `app.js` further.
3. Extend `applySearchReward()` to award equipment from valid non-medical searchable supply entities.
4. Apply tool effects before final action scoring.
5. Apply weapon effects inside `applyRoomEntityOutcome()` where the existing combat bonus is consumed.
6. Apply armor inside `applyDamage()` before Burned/Shocked modifiers are finalized, while excluding bleed damage.
7. Add compact equipment badges to teacher and player status displays.
8. Include equipment in `/api/player-session` vitals so player devices remain synchronized.
9. Add equipment result facts to narration prompts, but never send raw inventory mechanics in player-facing prose.
10. Either migrate the existing one-use `player.bonuses` combat reward into equipment or keep a short compatibility adapter; do not maintain two permanent gear systems.

Open design decision for the user: should newly found equipment auto-equip, replace the oldest item when both slots are full, or ask the teacher/player to choose? The simplest first iteration is auto-equip into an empty slot and convert overflow into a one-use temporary bonus.

## Known Risk Areas

- `app.js` is very large and remains the main cleanup target.
- There is no automated browser regression suite.
- The question reveal, answer clearing, timer start, player submission, and side-action paths are timing-sensitive.
- Do not reintroduce duplicate question publishing or stale prompt IDs.
- Map movement must only occur when leaving a room, not between phases of the same boss.
- Boss music/eyes should begin with the first boss question narration and fade out when leaving the boss room.
- Recovery choice must happen after entering the recovery room, not inside the prior consequence.
- TTS playback must not start before visible question text, and auto-advance should wait for narration when configured.
- iPhone Safari generally does not support `navigator.vibrate`; haptic code cannot force unsupported hardware behavior.
- Temporary Cloudflare URLs depend on the local server and laptop remaining online.

## Verification Checklist for Future Changes

At minimum:

```powershell
node --check app.js
node --check player.js
node --check server.js
node --check question-bank.js
node --check tts-manager.js
git diff --check
```

For browser testing, only do so when it is safe to disturb the active session. Test both single-device and multi-device modes, and use a cache-busting query string after changing front-end assets.

High-value manual scenarios:

1. Mission setup and deployment ready check.
2. First question appears once with no stale Submitted badges.
3. All required multi-device responders must answer.
4. Player action before an answer does not clear or auto-submit answers.
5. Emergency timer starts only when controls are ready and stops on resolution.
6. Fill-in blank visibly retains `____`.
7. Boss remains in one room across phases.
8. Recovery waits for a choice and then offers Continue.
9. TTS begins after visible text and releases audio ducking smoothly.
10. Map reveals only reached rooms and exposes the next room during travel.


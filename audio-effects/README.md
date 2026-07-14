# Custom Sound Effects

Put your sound effect files in this folder and list them in `audio-effects.json`.

The default manifest expects these filenames:

- `ui.wav`
- `ui-effect-small.mp3` (dashboard panels and default typewriter tick)
- `question.wav`
- `submitted.wav`
- `correct.wav`
- `incorrect.wav`
- `damage.wav`
- `loot.wav`
- `timer.wav`
- `emergency.wav`
- `transition.wav`
- `recovery.wav`
- `boss.wav`
- `failure.wav` or `failure.mp3`
- `ending.wav`

You can use `.wav`, `.mp3`, `.ogg`, `.m4a`, `.aac`, or `.flac` files. Update the `src` value in `audio-effects.json` if you use different names.

The deployment intro first looks for `ending.wav` and falls back to the configured ending effect if that WAV is not present.
Mission failure stops background and boss audio, then looks for `failure.wav` and `failure.mp3` in that order.

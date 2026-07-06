# Local Piper TTS Setup

This project is wired for the Rhasspy Piper voice:

`en_GB/northern_english_male/medium`

Expected local paths:

- `tts/piper/piper.exe`
- `tts/voices/en_GB-northern_english_male-medium.onnx`
- `tts/voices/en_GB-northern_english_male-medium.onnx.json`

Run this from PowerShell in the project folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-piper-northern-voice.ps1
```

Then restart the Study Adventure server and open:

`http://localhost:4174/index.html`

In the session screen, open `Mission Audio` and set `Provider` to `Local Piper`.

Sources:

- Piper Windows engine: https://github.com/rhasspy/piper/releases
- Voice files: https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_GB/northern_english_male/medium

import json
import os
import sys
import time
import wave
from array import array
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RUNTIME_DIR = Path(os.environ.get("KOKORO_RUNTIME", ROOT / "tts" / "kokoro" / "runtime"))
MODEL_DIR = Path(os.environ.get("KOKORO_MODEL_DIR", ROOT / "tts" / "kokoro" / "model" / "kokoro-en-v0_19"))
sys.path.insert(0, str(RUNTIME_DIR))

import sherpa_onnx  # noqa: E402


def send(payload):
    sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def build_tts():
    config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=str(MODEL_DIR / "model.onnx"),
                voices=str(MODEL_DIR / "voices.bin"),
                tokens=str(MODEL_DIR / "tokens.txt"),
                data_dir=str(MODEL_DIR / "espeak-ng-data"),
            ),
            num_threads=max(1, int(os.environ.get("KOKORO_THREADS", "4"))),
            debug=False,
            provider="cpu",
        ),
        max_num_sentences=1,
    )
    if not config.validate():
        raise RuntimeError("Kokoro configuration is invalid")
    return sherpa_onnx.OfflineTts(config)


def write_wav(output_path, samples, sample_rate):
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    pcm = array("h", (max(-32768, min(32767, round(float(sample) * 32767))) for sample in samples))
    with wave.open(str(output), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm.tobytes())


def main():
    started = time.perf_counter()
    tts = build_tts()
    send({
        "type": "ready",
        "loadMs": round((time.perf_counter() - started) * 1000),
        "sampleRate": int(tts.sample_rate),
        "speakers": int(tts.num_speakers),
    })

    for line in sys.stdin:
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            text = str(request.get("text", "")).strip()
            if not text:
                raise ValueError("Missing text")
            sid = max(0, min(int(tts.num_speakers) - 1, int(request.get("sid", 10))))
            speed = max(0.75, min(1.25, float(request.get("rate", 1))))
            output_path = request.get("outputPath")
            if not output_path:
                raise ValueError("Missing output path")

            generated_at = time.perf_counter()
            audio = tts.generate(text, sid=sid, speed=speed)
            write_wav(output_path, audio.samples, audio.sample_rate)
            send({
                "id": request_id,
                "ok": True,
                "outputPath": str(output_path),
                "voiceId": sid,
                "durationMs": round(len(audio.samples) * 1000 / audio.sample_rate),
                "generationMs": round((time.perf_counter() - generated_at) * 1000),
            })
        except Exception as error:
            send({"id": request_id, "ok": False, "error": str(error)})


if __name__ == "__main__":
    main()

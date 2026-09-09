#!/usr/bin/env python3
# Transcribe an audio/video file with faster-whisper → JSON on stdout:
#   { "language": "ja", "duration": 24.0, "segments": [ {start,end,text}, ... ] }
# Usage: whisper_transcribe.py <audio_or_video> [model_size]
import sys, json

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: whisper_transcribe.py <file> [model]"})); return
    path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "base"
    try:
        from faster_whisper import WhisperModel
    except Exception as e:
        print(json.dumps({"error": "faster-whisper not installed — run local-voice-server/setup-whisper.sh (%s)" % e})); return
    try:
        model = WhisperModel(model_size, device="cpu", compute_type="int8")
        segments, info = model.transcribe(path, vad_filter=True, beam_size=5)
        out = {"language": info.language, "duration": round(getattr(info, "duration", 0.0) or 0.0, 3), "segments": []}
        for s in segments:
            t = (s.text or "").strip()
            if t:
                out["segments"].append({"start": round(s.start, 3), "end": round(s.end, 3), "text": t})
        print(json.dumps(out, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()

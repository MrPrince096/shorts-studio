#!/bin/bash
# Set up Kokoro TTS (fast, natural, offline) for Shorts Studio.
# Uses the lightweight ONNX build (onnxruntime, no PyTorch) in its own venv so it
# never conflicts with the XTTS venv. Installs into ~/kokoro-tts.
set -e
PY=/Library/Frameworks/Python.framework/Versions/3.11/bin/python3.11
KROOT="$HOME/kokoro-tts"
MODEL="$KROOT/kokoro-v1.0.onnx"
VOICES="$KROOT/voices-v1.0.bin"

echo "==> 1/3 venv + kokoro-onnx"
mkdir -p "$KROOT"
[ -d "$KROOT/venv" ] || "$PY" -m venv "$KROOT/venv"
source "$KROOT/venv/bin/activate"
pip install --upgrade pip wheel >/dev/null
pip install "kokoro-onnx>=0.4.9" soundfile numpy fastapi "uvicorn[standard]"

echo "==> 2/3 model + voices (~330MB)"
BASE="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
[ -f "$MODEL" ]  || curl -L --fail --retry 5 -C - -o "$MODEL"  "$BASE/kokoro-v1.0.onnx"
[ -f "$VOICES" ] || curl -L --fail --retry 5 -C - -o "$VOICES" "$BASE/voices-v1.0.bin"

echo "==> 3/3 done"
echo "    venv:   $KROOT/venv"
echo "    model:  $MODEL"
echo "Start with:  bash local-voice-server/start-kokoro.command"

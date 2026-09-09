#!/bin/bash
# Set up faster-whisper (local speech-to-text) for the Dub tool on Apple Silicon.
# Installs into ~/whisper-asr with its own Python 3.11 venv. Models auto-download
# on first use (base ≈ 150MB). CPU int8 — fast enough on an M1 for short clips.
set -e
PY=/Library/Frameworks/Python.framework/Versions/3.11/bin/python3.11
[ -x "$PY" ] || PY=python3
ROOT="$HOME/whisper-asr"
echo "==> 1/2 venv + faster-whisper"
mkdir -p "$ROOT"
[ -d "$ROOT/venv" ] || "$PY" -m venv "$ROOT/venv"
source "$ROOT/venv/bin/activate"
pip install --upgrade pip wheel >/dev/null
pip install "faster-whisper>=1.0.0"
echo "==> 2/2 done"
echo "    venv:   $ROOT/venv"
echo "    python: $ROOT/venv/bin/python"
echo "The transcription model downloads automatically the first time you dub a video."

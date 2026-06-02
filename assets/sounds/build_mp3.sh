#!/usr/bin/env bash
# Regenerate the Border Chess sound set: synthesize WAVs, encode to MP3.
# Requires: python3 (stdlib only) + ffmpeg.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

python3 generate_sounds.py

for wav in *.wav; do
  name="${wav%.wav}"
  ffmpeg -y -loglevel error -i "$wav" \
    -ac 1 -ar 44100 -codec:a libmp3lame -b:a 96k "$name.mp3"
  echo "encoded $name.mp3"
done

rm -f ./*.wav
echo "done: $(ls -1 *.mp3 | tr '\n' ' ')"

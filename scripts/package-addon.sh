#!/usr/bin/env bash
# Builds anki_leaderboard.ankiaddon: the add-on's files at the zip root (no top-level folder), no caches.
set -euo pipefail
cd "$(dirname "$0")/../addon"
out="../anki_leaderboard.ankiaddon"
rm -f "$out"
zip -r -q "$out" . -x "__pycache__/*" "*/__pycache__/*" "*.pyc" ".DS_Store"
unzip -l "$out"

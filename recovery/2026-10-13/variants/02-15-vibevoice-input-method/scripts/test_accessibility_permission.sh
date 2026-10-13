#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h:h}"
binary="$project_dir/dist/VibeVoiceInput.app/Contents/MacOS/VibeVoiceInput"

"$binary" --check-accessibility

#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h:h}"
app_dir="$project_dir/dist/VibeVoiceInput.app"
requirement=$(codesign -d -r- "$app_dir" 2>&1)

if [[ "$requirement" == *"cdhash H\""* ]]; then
  echo "FAIL: unstable ad-hoc identity; Accessibility permission will not survive rebuilds"
  exit 1
fi

if [[ "$requirement" != *"identifier \"local.outsider.vibevoice-input\""* ]]; then
  echo "FAIL: bundle identifier is missing from the signing requirement"
  exit 1
fi

echo "PASS: stable Accessibility signing identity"

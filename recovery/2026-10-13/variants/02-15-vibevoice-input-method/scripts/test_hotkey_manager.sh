#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h:h}"
test_bin="$project_dir/.build/hotkey-manager-smoke"
sender_bin="$project_dir/.build/hotkey-event-sender"

mkdir -p "$project_dir/.build"
swiftc \
  "$project_dir/Sources/VibeVoiceInput/HotKeyManager.swift" \
  "$project_dir/scripts/hotkey_manager_smoke.swift" \
  -o "$test_bin"
swiftc "$project_dir/scripts/hotkey_event_sender.swift" -o "$sender_bin"
"$test_bin" "$sender_bin"

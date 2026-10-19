#!/bin/sh
set -eu
umask 077
task_probe_root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
task_probe_hash=$(shasum -a 256 "$task_probe_root/scripts/benchmark/apple-speech-probe.m" "$task_probe_root/src-tauri/native/apple_speech.m" | shasum -a 256 | cut -c 1-16)
task_probe_bundle="${TMPDIR:-/private/tmp}/withtype-speech-probe-${task_probe_hash}.app"
task_probe_binary="$task_probe_bundle/Contents/MacOS/withtype-speech-probe"
if [ ! -x "$task_probe_binary" ]; then
  mkdir -p "$task_probe_bundle/Contents/MacOS"
  cat > "$task_probe_bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.withtype.speech-probe</string>
<key>CFBundleName</key><string>WithType Speech Probe</string>
<key>CFBundleExecutable</key><string>withtype-speech-probe</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
<key>NSSpeechRecognitionUsageDescription</key><string>Run explicitly requested Apple Speech fixture comparisons.</string>
</dict></plist>
PLIST
  xcrun --sdk macosx clang -fobjc-arc -Wall -Wextra -mmacosx-version-min=14.0 \
    "$task_probe_root/scripts/benchmark/apple-speech-probe.m" \
    "$task_probe_root/src-tauri/native/apple_speech.m" \
    -framework Foundation -framework Speech -o "$task_probe_binary"
  codesign --force --sign - "$task_probe_bundle" >&2
fi
run_probe() {
  # LaunchServices makes this app its own TCC-responsible process. Directly
  # exec'ing the binary would attribute Speech to the terminal/automation host,
  # whose bundle may not contain Speech's required privacy usage description.
  task_probe_ipc=$(mktemp -d "${TMPDIR:-/private/tmp}/withtype-speech-ipc.XXXXXX")
  mkfifo "$task_probe_ipc/input" "$task_probe_ipc/output"
  trap 'rm -rf "$task_probe_ipc"' EXIT HUP INT TERM
  exec 3<&0
  open -n -W -g "$task_probe_bundle" --args --jsonl "$task_probe_ipc/input" "$task_probe_ipc/output" >&2 &
  task_probe_launcher=$!
  cat <&3 > "$task_probe_ipc/input" &
  task_probe_writer=$!
  cat "$task_probe_ipc/output"
  wait "$task_probe_writer"
  wait "$task_probe_launcher"
}
if [ "${1:-}" = "--authorize" ]; then
  printf '%s\n' '{"id":"apple-speech-authorization","command":"request_authorization","args":{"locale":"zh-CN"}}' | run_probe
  exit $?
fi
run_probe

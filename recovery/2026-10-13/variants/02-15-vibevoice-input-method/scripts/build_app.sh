#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h:h}"
app_dir="$project_dir/dist/VibeVoiceInput.app"
signing_identity="${VIBEVOICE_CODESIGN_IDENTITY:-}"

cd "$project_dir"
swift build -c release

mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
cp "$project_dir/.build/release/VibeVoiceInput" "$app_dir/Contents/MacOS/VibeVoiceInput"
cp "$project_dir/resources/Info.plist" "$app_dir/Contents/Info.plist"

if [[ -z "$signing_identity" ]]; then
  signing_identity=$(security find-identity -v -p codesigning \
    | sed -n 's/^[[:space:]]*[0-9]*) [A-F0-9]* "\(Apple Development:[^"]*\)"$/\1/p' \
    | head -1)
fi

if [[ -z "$signing_identity" ]]; then
  echo "未找到稳定的 Apple Development 签名身份。" >&2
  echo "请设置 VIBEVOICE_CODESIGN_IDENTITY 后重试；拒绝回退到会破坏辅助功能授权的临时签名。" >&2
  exit 1
fi

codesign --force --deep --sign "$signing_identity" "$app_dir"

echo "$app_dir"

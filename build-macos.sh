#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { echo '请在 macOS 上构建 Mac APP。' >&2; exit 1; }
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$project_root"
case "$(uname -m)" in
  arm64) target=aarch64-apple-darwin ;;
  x86_64) target=x86_64-apple-darwin ;;
  *) echo '不支持的 Mac CPU 架构。' >&2; exit 1 ;;
esac
npm run desktop:build -- --target "$target" --bundles app
npm run verify:appearance
build_root="${CARGO_TARGET_DIR:-$project_root/src-tauri/target}"
app="$build_root/$target/release/bundle/macos/WithType.app"
codesign --verify --deep --strict "$app"
mkdir -p dist/macos
ditto "$app" dist/macos/WithType.app
codesign --verify --deep --strict dist/macos/WithType.app
ditto -c -k --sequesterRsrc --keepParent dist/macos/WithType.app "dist/macos/WithType-$target.zip"
shasum -a 256 "dist/macos/WithType-$target.zip" > "dist/macos/WithType-$target.zip.sha256"
echo "可运行 APP：$project_root/dist/macos/WithType.app"

#!/usr/bin/env bash
# Windows 本机构建：在 MSYS2 / Git Bash 中运行，无需硬编码用户名。
# 先安装 stable-x86_64-pc-windows-gnu 和 MSYS2 mingw-w64-x86_64-toolchain。
# 自定义 MSYS2 安装位置：TYPEFREE_MINGW_DIR=/c/path/to/msys64/mingw64/bin ./build-local.sh
set -euo pipefail

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *) echo '此脚本需要 Windows 的 MSYS2 / Git Bash；Mac 请使用 Windows 虚拟机或 Windows CI。' >&2; exit 1 ;;
esac

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$project_root"
command -v cygpath >/dev/null || { echo '找不到 cygpath，请使用 MSYS2 / Git Bash。' >&2; exit 1; }

mingw_bin="${TYPEFREE_MINGW_DIR:-}"
if [[ -n "$mingw_bin" ]]; then
  mingw_bin="$(cygpath -u "$mingw_bin")"
else
  for candidate in "${MINGW_PREFIX:-/mingw64}/bin" "$HOME/.tools/msys2/msys64/mingw64/bin" /c/msys64/mingw64/bin; do
    if [[ -x "$candidate/gcc.exe" ]]; then
      mingw_bin="$candidate"
      break
    fi
  done
fi
if [[ -z "$mingw_bin" || ! -x "$mingw_bin/gcc.exe" ]]; then
  echo '找不到 MinGW-w64 gcc.exe，请将 TYPEFREE_MINGW_DIR 指向 MSYS2 的 mingw64/bin。' >&2
  exit 1
fi

export PATH="$mingw_bin:$HOME/.cargo/bin:$PATH"
export RUSTUP_TOOLCHAIN="${TYPEFREE_RUST_TOOLCHAIN:-stable-x86_64-pc-windows-gnu}"
target=x86_64-pc-windows-gnu
for tool in node npm rustup cargo rustc gcc g++ ar dlltool windres powershell.exe; do
  command -v "$tool" >/dev/null || { echo "找不到 $tool，请检查 Windows 构建依赖和 TYPEFREE_MINGW_DIR。" >&2; exit 1; }
done
if [[ "$(gcc -dumpmachine)" != x86_64-w64-mingw32 ]]; then
  echo '需要 mingw64 的 x86_64-w64-mingw32 gcc，不能使用 MSYS 的 gcc。' >&2
  exit 1
fi
if ! rust_info="$(rustc -vV)"; then
  echo "请先运行：rustup toolchain install $RUSTUP_TOOLCHAIN" >&2
  exit 1
fi
if [[ "$rust_info" != *"host: $target"* ]]; then
  echo "Rust 工具链必须是 $target；当前为 $RUSTUP_TOOLCHAIN。" >&2
  exit 1
fi

# 明确使用同一套 MinGW 工具，dlltool 也必须在 PATH 中供 Rust raw-dylib 使用。
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER="$(cygpath -w "$mingw_bin/gcc.exe")"
export CC_x86_64_pc_windows_gnu="$CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER"
export CXX_x86_64_pc_windows_gnu="$(cygpath -w "$mingw_bin/g++.exe")"
export AR_x86_64_pc_windows_gnu="$(cygpath -w "$mingw_bin/ar.exe")"
# 与参考项目保持一致：汇编通过管道传递，兼容会处理临时文件的企业 DLP 环境。
export CFLAGS_x86_64_pc_windows_gnu="${CFLAGS_x86_64_pc_windows_gnu:+$CFLAGS_x86_64_pc_windows_gnu }-pipe"
export CXXFLAGS_x86_64_pc_windows_gnu="${CXXFLAGS_x86_64_pc_windows_gnu:+$CXXFLAGS_x86_64_pc_windows_gnu }-pipe"
export CARGO_TARGET_DIR="$(cygpath -w "$project_root/src-tauri/target")"

echo "Rust: $RUSTUP_TOOLCHAIN"
echo "MinGW: $mingw_bin"
npm ci
npm test
cargo test --manifest-path src-tauri/Cargo.toml --target "$target" --lib
npm run desktop:build -- --target "$target"
powershell.exe -NoProfile -File "$(cygpath -w "$project_root/scripts/package-windows.ps1")" \
  -ReleaseDir "$(cygpath -w "$project_root/src-tauri/target/$target/release")" \
  -OutputDir "$(cygpath -w "$project_root/dist/windows")"

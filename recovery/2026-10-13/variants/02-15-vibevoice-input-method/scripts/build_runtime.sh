#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h:h}"
runtime_dir="$project_dir/runtime/VibeASR.cpp-main"

if [[ ! -f "$runtime_dir/3rdparty/llama.cpp/CMakeLists.txt" ]]; then
  echo "缺少 runtime/VibeASR.cpp-main/3rdparty/llama.cpp" >&2
  exit 1
fi

cmake -S "$runtime_dir" -B "$runtime_dir/build" -DCMAKE_BUILD_TYPE=Release
cmake --build "$runtime_dir/build" --target asr_stream_server asr_infer -j 4

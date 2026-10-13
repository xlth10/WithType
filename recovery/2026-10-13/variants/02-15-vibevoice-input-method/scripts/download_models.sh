#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h:h}"
model_dir="$project_dir/runtime/VibeASR.cpp-main/models/vibeasr"
# ModelScope mirrors the same Microsoft release and exposes matching SHA-256
# hashes. It is the default because Hugging Face is often unreachable in China.
# Override with VIBEVOICE_MODEL_BASE_URL when another endpoint is preferred.
base_url="${VIBEVOICE_MODEL_BASE_URL:-https://www.modelscope.cn/models/microsoft/VibeVoice-ASR-BitNet/resolve/master}"

mkdir -p "$model_dir"
wget -c --timeout=30 --read-timeout=30 --waitretry=2 --tries=0 \
  -O "$model_dir/vibeasr-vae-encoder-i8_s.gguf" \
  "$base_url/vibeasr-vae-encoder-i8_s.gguf"
wget -c --timeout=30 --read-timeout=30 --waitretry=2 --tries=0 \
  -O "$model_dir/vibeasr-lm-i2_s-embed-q6_k.gguf" \
  "$base_url/vibeasr-lm-i2_s-embed-q6_k.gguf"

echo "4941c82608c253ec066b5cc74d3dd11a5c8fef96cccbc5b87359ef0fe4338df6  $model_dir/vibeasr-vae-encoder-i8_s.gguf" | shasum -a 256 -c -
echo "fbe273d8dc2f2433bb25f849e19d77ea65aaa2188d12c20cee987ab6f321e002  $model_dir/vibeasr-lm-i2_s-embed-q6_k.gguf" | shasum -a 256 -c -

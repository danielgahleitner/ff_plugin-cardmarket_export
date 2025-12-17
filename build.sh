#!/usr/bin/env bash
set -euo pipefail

EXT_DIR="extension"
OUT_ZIP="upload.zip"

# Avoid macOS metadata pollution in zips
export COPYFILE_DISABLE=1

cmd="${1:-zip}"

if [[ "$cmd" == "zip" ]]; then
  rm -f "$OUT_ZIP"
  find "$EXT_DIR" -name ".DS_Store" -delete

  ( cd "$EXT_DIR" && \
    zip -r "../$OUT_ZIP" . \
      -x "**/.DS_Store" \
      -x "**/__MACOSX/*" \
      -x "**/._*" )

  echo "✅ Created $OUT_ZIP (upload this to AMO)"
  exit 0
fi

if [[ "$cmd" == "hash" ]]; then
  XPI_PATH="${2:-}"
  if [[ -z "$XPI_PATH" || ! -f "$XPI_PATH" ]]; then
    echo "Usage: ./build.sh hash /path/to/signed.xpi"
    exit 1
  fi

  # Compute SHA-256 (macOS + Linux compatible)
  if command -v shasum >/dev/null 2>&1; then
    SHA="$(shasum -a 256 "$XPI_PATH" | awk '{print $1}')"
  else
    SHA="$(sha256sum "$XPI_PATH" | awk '{print $1}')"
  fi

  echo "sha256:$SHA"
  echo
  echo "Paste into updates.json:"
  echo "  \"update_hash\": \"sha256:$SHA\""
  exit 0
fi

echo "Unknown command: $cmd"
echo "Usage:"
echo "  ./build.sh zip"
echo "  ./build.sh hash /path/to/signed.xpi"
exit 1

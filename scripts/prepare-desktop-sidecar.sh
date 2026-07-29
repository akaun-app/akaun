#!/usr/bin/env bash
# Stages the Bun server as a Tauri sidecar payload: a copied `bun` executable
# (named per Tauri's externalBin target-triple convention) plus a pruned,
# production-only `node_modules` + `build/` + `drizzle/` + `server.js` tree,
# run verbatim with the sidecar's cwd set to this directory. This mirrors the
# Dockerfile's runtime stage (see deploy/Dockerfile) rather than using
# `bun build --compile`, because argon2's native binding, tesseract.js-core's
# .wasm files, and pdfkit's .afm/.icc files are all loaded from real
# filesystem paths at runtime and don't survive being flattened into a single
# compiled executable.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_DIR="$ROOT_DIR/src-tauri"
STAGING_DIR="$TAURI_DIR/resources/sidecar"
BINARIES_DIR="$TAURI_DIR/binaries"

if [ ! -d "$ROOT_DIR/build" ]; then
	echo "error: $ROOT_DIR/build does not exist — run 'bun run build' first" >&2
	exit 1
fi

echo "==> Staging sidecar payload in $STAGING_DIR"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

cp -R "$ROOT_DIR/build" "$STAGING_DIR/build"
cp -R "$ROOT_DIR/drizzle" "$STAGING_DIR/drizzle"
cp "$ROOT_DIR/server.js" "$STAGING_DIR/server.js"
cp "$ROOT_DIR/package.json" "$STAGING_DIR/package.json"
cp "$ROOT_DIR/bun.lock" "$STAGING_DIR/bun.lock"

echo "==> Installing production dependencies into staged payload"
(cd "$STAGING_DIR" && bun install --production --frozen-lockfile)

echo "==> Verifying native/asset dependencies survived pruning"
fail=0

if ! find "$STAGING_DIR/node_modules/argon2/prebuilds" -name '*.node' -print -quit | grep -q .; then
	echo "error: no argon2 native .node prebuild found under node_modules/argon2/prebuilds" >&2
	fail=1
fi

if ! find "$STAGING_DIR/node_modules/tesseract.js-core" -name '*.wasm' -print -quit | grep -q .; then
	echo "error: no tesseract.js-core .wasm files found" >&2
	fail=1
fi

if ! find "$STAGING_DIR/node_modules/pdfkit/js/data" -name '*.afm' -print -quit | grep -q .; then
	echo "error: no pdfkit .afm font files found" >&2
	fail=1
fi

if [ "$fail" -ne 0 ]; then
	echo "error: sidecar payload is missing required native/asset files, aborting" >&2
	exit 1
fi

echo "==> Copying bun executable into Tauri externalBin location"
mkdir -p "$BINARIES_DIR"
BUN_BIN="$(command -v bun)"
TARGET_TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
if [ -z "$TARGET_TRIPLE" ]; then
	echo "error: could not determine target triple via 'rustc -vV'" >&2
	exit 1
fi
EXE_SUFFIX=""
case "$TARGET_TRIPLE" in
	*windows*) EXE_SUFFIX=".exe" ;;
esac
cp "$BUN_BIN" "$BINARIES_DIR/bun-$TARGET_TRIPLE$EXE_SUFFIX"
chmod +x "$BINARIES_DIR/bun-$TARGET_TRIPLE$EXE_SUFFIX"

echo "==> Done"
echo "    payload:  $(du -sh "$STAGING_DIR" | cut -f1)  ($(find "$STAGING_DIR" -type f | wc -l | tr -d ' ') files)"
echo "    sidecar:  $BINARIES_DIR/bun-$TARGET_TRIPLE$EXE_SUFFIX"

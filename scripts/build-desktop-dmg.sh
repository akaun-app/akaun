#!/usr/bin/env bash
# Builds Akaun.app via Tauri and packages it into a .dmg, for use both
# locally and in CI. Deliberately does NOT use Tauri's built-in "dmg" bundle
# target (bundle_dmg.sh), which invokes the same underlying create-dmg tool
# but always runs its Finder-prettifying AppleScript step — that requires an
# interactive session with Automation permission granted and times out in
# headless/restricted environments. Instead this calls the create-dmg
# submodule (scripts/create-dmg, same tool/pattern used by the native Akaun
# macOS app) directly with --skip-jenkins, which keeps the nice icon-position
# + drop-to-Applications window layout but skips only the AppleScript step.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CREATE_DMG="scripts/create-dmg/create-dmg"
if [ ! -x "$CREATE_DMG" ]; then
	echo "error: $CREATE_DMG not found or not executable — did you run 'git submodule update --init'?" >&2
	exit 1
fi

echo "==> Building Akaun.app via Tauri"
bun run desktop:build

APP_PATH="$(find src-tauri/target/release/bundle/macos -maxdepth 1 -name '*.app' -print -quit)"
if [ -z "$APP_PATH" ]; then
	echo "error: no .app bundle found under src-tauri/target/release/bundle/macos" >&2
	exit 1
fi

echo "==> Ad-hoc signing (so a downloaded, unsigned app isn't flagged 'damaged' by Gatekeeper)"
xattr -cr "$APP_PATH"
codesign --force --deep --sign - "$APP_PATH"

VERSION="${AKAUN_DESKTOP_VERSION:-$(grep -m1 '"version"' src-tauri/tauri.conf.json | sed -E 's/.*"version": *"([^"]+)".*/\1/')}"
OUT_DIR="src-tauri/target/release/bundle/dmg"
DMG_NAME="Akaun-${VERSION}.dmg"
DMG_PATH="$OUT_DIR/$DMG_NAME"

echo "==> Packaging $DMG_NAME"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
rm -f "$DMG_PATH"

bash "$CREATE_DMG" \
	--volname "Akaun" \
	--window-size 500 320 \
	--icon-size 96 \
	--icon "Akaun.app" 150 160 \
	--app-drop-link 350 160 \
	--no-internet-enable \
	--skip-jenkins \
	"$DMG_PATH" \
	"$APP_PATH"

echo "==> Done: $DMG_PATH"

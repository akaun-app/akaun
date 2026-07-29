#!/usr/bin/env bash
# Builds Akaun.app via Tauri and packages it into a .dmg, for use both
# locally and in CI. Deliberately does NOT use Tauri's built-in "dmg" bundle
# target (bundle_dmg.sh) or the create-dmg tool, both of which build the DMG
# by mounting a temporary read-write image, copying files in via Finder/an
# external script, then calling a plain (non -force) "hdiutil detach" — that
# detach reliably hangs for ~120s and fails with "hdiutil: detach: timeout
# for DiskArbitration expired" on GitHub Actions' macOS runners once this
# app's ~14k+ file sidecar payload is involved (root cause isn't Spotlight:
# disabling indexing made no measurable difference — see git history).
# `hdiutil create -srcfolder` builds the compressed image directly, with no
# separate mount → touch-every-file → detach dance to hang on, and is the
# standard approach for a DMG with no custom Finder background/icon layout
# (which this app doesn't use anyway).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

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

STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT

cp -R "$APP_PATH" "$STAGE_DIR/"
ln -s /Applications "$STAGE_DIR/Applications"

# Force-detach any leftover "Akaun" mount from a previous failed attempt so a
# retry doesn't collide with a stuck volume of the same name. The trailing
# `|| true` on the pipeline (not just inside the while loop) matters: under
# `set -e`, a pipeline that ends in "no stale mount found" (grep exits 1 on
# no match) would otherwise abort this whole script the moment this function
# is called.
force_detach_stale_mounts() {
	hdiutil info | grep -B 8 '/Volumes/Akaun' | grep '^/dev/disk' | awk '{print $1}' | sort -u |
		while read -r dev; do
			hdiutil detach "$dev" -force >/dev/null 2>&1 || true
		done || true
}

MAX_ATTEMPTS=3
attempt=1
until hdiutil create -volname "Akaun" -srcfolder "$STAGE_DIR" -fs HFS+ -format UDZO -ov -o "$DMG_PATH"; do
	if (( attempt >= MAX_ATTEMPTS )); then
		echo "error: hdiutil create failed after $MAX_ATTEMPTS attempts" >&2
		exit 1
	fi
	echo "==> hdiutil create failed (attempt $attempt/$MAX_ATTEMPTS) — cleaning up and retrying" >&2
	force_detach_stale_mounts
	rm -f "$DMG_PATH"
	attempt=$(( attempt + 1 ))
	sleep 5
done

echo "==> Done: $DMG_PATH"

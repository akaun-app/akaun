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

# Spotlight/mdworker indexing the DMG volume while it holds ~14k+ sidecar
# files is what causes "hdiutil: detach: timeout for DiskArbitration expired"
# on GitHub Actions' virtualized macOS runners (never seen on a local Mac's
# real SSD, which settles fast enough). Disabling indexing up front removes
# the contention instead of just retrying around it.
sudo mdutil -i off -a >/dev/null 2>&1 || true

# Force-detach any leftover mount from a previous failed attempt so a retry
# doesn't immediately collide with a stuck volume. create-dmg mounts the
# intermediate rw image under a randomized "/Volumes/dmg.XXXXXX" name (not
# "/Volumes/Akaun", which is only the final read-only volume's label), so
# match both. The trailing `return 0` is required: under `set -e`, a plain
# "no stale mount found" (grep exits 1 on no match) would otherwise abort
# this whole script the moment the retry loop below calls this function.
force_detach_stale_mounts() {
	hdiutil info | grep -B 8 -E '/Volumes/(Akaun|dmg\.)' | grep '^/dev/disk' | awk '{print $1}' | sort -u |
		while read -r dev; do
			hdiutil detach "$dev" -force >/dev/null 2>&1 || true
		done
	return 0
}

# create-dmg only auto-retries on "Resource busy"; a DiskArbitration detach
# timeout (seen in CI on this app's large sidecar payload — 14k+ files in
# node_modules, which gives Spotlight/diskarbitrationd a lot more to settle
# on than a small native app bundle) exits immediately instead. Retry the
# whole create-dmg run ourselves for that case.
MAX_ATTEMPTS=3
attempt=1
until bash "$CREATE_DMG" \
	--volname "Akaun" \
	--window-size 500 320 \
	--icon-size 96 \
	--icon "Akaun.app" 150 160 \
	--app-drop-link 350 160 \
	--no-internet-enable \
	--skip-jenkins \
	--hdiutil-retries 8 \
	"$DMG_PATH" \
	"$APP_PATH"; do
	if (( attempt >= MAX_ATTEMPTS )); then
		echo "error: create-dmg failed after $MAX_ATTEMPTS attempts" >&2
		exit 1
	fi
	echo "==> create-dmg failed (attempt $attempt/$MAX_ATTEMPTS) — likely a transient DiskArbitration detach timeout; cleaning up and retrying" >&2
	force_detach_stale_mounts
	rm -f "$DMG_PATH"
	attempt=$(( attempt + 1 ))
	sleep 5
done

echo "==> Done: $DMG_PATH"

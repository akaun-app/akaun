# design/

Source artwork. Nothing here is served or bundled — it lives outside `static/`
on purpose, so the masters don't get published to the web root or swept into the
service-worker precache (`vite.config.ts` globs all of `static/`).

| File              | What it is                                     |
| ----------------- | ---------------------------------------------- |
| `icon.svg`        | Vector master, 800×800                          |
| `icon-master.png` | Raster master, 1600×1600                        |

**Note:** both masters are the *white glyph on transparent* variant. The shipped
icons put that glyph on an orange squircle (`rgb(231, 92, 23)`), and that
composite step happened outside this repo — so these files are the glyph source,
not a pixel-exact master of what ships.

## Regenerating

**Desktop icons** (`src-tauri/icons/`) are generated output, not hand-maintained:

```sh
bunx tauri icon path/to/source.png
```

That writes the full set. The build only consumes the five files listed in
`src-tauri/tauri.conf.json` (`32x32.png`, `128x128.png`, `128x128@2x.png`,
`icon.icns`, `icon.ico`) plus `icon.png` as the source of record — the Windows
Store/MSIX tiles it also emits (`Square*Logo.png`, `StoreLogo.png`) were removed
because the bundle targets are `app`/`dmg`/`nsis` only. Re-run the command above
if an MSIX target is ever added.

`src-tauri/icons/tray-icon.png` is **not** part of that generated set — it's a
hand-made 44×44 monochrome alpha-only mark used as a macOS template image
(auto-tinted for light/dark menu bars). Windows and Linux use `32x32.png` for
the tray instead, so their tray icon matches the taskbar icon.

**Web maskable icon** (`static/icons/icon-maskable-512.png`) is derived from
`static/icons/icon-512.png`:

```sh
bun run scripts/gen-maskable-icon.ts
```

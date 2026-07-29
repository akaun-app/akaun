# deploy/

Container build and runtime files. Everything here expects the **repo root** as
the Docker build context, not this directory.

| File                      | Purpose                                                             |
| ------------------------- | ------------------------------------------------------------------- |
| `Dockerfile`              | Multi-stage build (deps → build → slim runtime on `oven/bun:alpine`) |
| `entrypoint.sh`           | Creates the `PUID`/`PGID` user, chowns `/app/data`, drops privileges |
| `docker-compose.yml`      | Local build-from-source stack                                        |
| `docker-compose.prod.yml` | Runs the published `ghcr.io/akaun-app/akaun:latest` image            |

## Local build

Run from **this directory** — compose resolves `context: ..` and the `../data`
volume relative to the file's location, so the data dir lands at the repo root:

```sh
cd deploy
docker compose up -d --build
```

Or from the repo root, pointing at the file explicitly:

```sh
docker compose -f deploy/docker-compose.yml up -d --build
```

To build the image directly, the context must be the repo root:

```sh
docker build -f deploy/Dockerfile -t akaun .
```

## Notes

- `.dockerignore` stays at the repo root — Docker only honours it at the build
  context root.
- `server.js` also stays at the repo root: it's the application entry point,
  shared by this Dockerfile's `CMD` and by the Tauri desktop sidecar
  (`src-tauri/src/lib.rs` runs `bun server.js` with the staged payload as cwd).
- `docker-compose.prod.yml` is a standalone template meant to be copied to a
  server, so its `./data` volume is intentionally relative to wherever the user
  puts it. The self-hosting guide in the root `README.md` inlines this content.

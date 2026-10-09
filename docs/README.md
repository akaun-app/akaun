# Akaun docs

The public documentation site, built with [Docusaurus](https://docusaurus.io/). It is a
separate Bun package with its own lockfile; the root app does not depend on it.

```bash
cd docs
bun install
bun start        # live preview at http://localhost:3000/
bun run build    # static output in build/
bun run serve    # serve that build at http://localhost:3000/
```

Pages live in `docs/docs/`. The sidebar is generated from that folder.

## Deployment

`.github/workflows/docs-publish.yml` builds the site on every push to `main` that touches
`docs/` and pushes `build/` to the `main` branch of `<org>/<org>.github.io` (today
`getakaun/getakaun.github.io`), which serves it at `https://<org>.github.io/`. It
authenticates with an SSH deploy key: the public half is a write-enabled deploy key on
the docs repo, the private half is the `DOCS_DEPLOY_KEY` Actions secret on this repo.

The org name comes from `github.repository_owner` (as `DOCS_ORG`), so renaming the GitHub
organization needs no change here, provided the docs repo is renamed to `<neworg>.github.io`.

# Working on hassio-claude-code (our fork)

> The general working rules live in [../CLAUDE.md](../CLAUDE.md). **This file is only what
> is untrue of the other projects**, and it lives on `ha-local` alone: the repository is
> tormjens's, so our notes stay out of anything sent upstream.

A fork of [tormjens/hassio-claude-code](https://github.com/tormjens/hassio-claude-code), the
"Claude for Home Assistant" add-on, cloned from `bdittes/hassio-claude-code` (`origin`) with
the maintainer's repo as `upstream`. It is not on Forgejo and the upstream docs are the
maintainer's, so the README / NEXTSTEPS / CHANGELOG arrangement does not apply here beyond
the add-on's own `claude-ha/CHANGELOG.md`.

## Two kinds of branch, never mixed

**`ha-local` is what our Home Assistant installs**, from the store URL
`https://github.com/bdittes/hassio-claude-code#ha-local`. It is upstream plus whatever we are
trying out, and nothing on it goes upstream as-is. Three invariants make it installable, and
breaking any of them breaks the install quietly:

- **No `image:` in `claude-ha/config.yaml`.** With it, Supervisor pulls upstream's prebuilt
  image for our version number, which does not exist, instead of building our code.
- **Plain `FROM` in the Dockerfile, not `FROM --platform=$BUILDPLATFORM`.** That form parses
  only under BuildKit; the legacy builder fails on it before the first step, and a device
  build has no cross-platform stage to save anyway.
- **Four-part versions (`0.1.8.2`), bumped in `config.yaml` and `CHANGELOG.md` with every
  change.** Supervisor offers an update only when the version moves, and the fourth part
  keeps us clear of every number upstream will release.

**Anything worth upstreaming gets its own branch from `upstream/main`**, with a normal
three-part version, and goes as a PR from the fork. `sdk-0.3.281-opus-5-5` was the first:
[PR #3](https://github.com/tormjens/hassio-claude-code/pull/3), merged unchanged on
2026-09-25. A feature proven on
`ha-local` is rebuilt on such a branch rather than cherry-picked with the invariants above
attached.

## Things measured once

- **The SDK decides which models exist.** The model picker is whatever the bundled Claude
  Code binary reports, and the API refuses a model an old CLI does not know
  (`Claude Code 2.1.263 does not support this model; version 2.1.280 or newer is required`),
  so a new model means an Agent SDK bump, not a config change.
- **Remote Control is out of reach as built.** The add-on authenticates with a
  `claude setup-token` token or an API key; Anthropic's docs say the first can only make model
  requests and the second is unsupported, and the run script sets
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, which disables the feature check it needs. Reach
  the panel through Home Assistant's own remote access instead.

## Before saying it works

Test in the image the Dockerfile builds with, not on the host's Node:

```sh
cd claude-ha
docker run --rm -v "$PWD:/w" -w /w/server node:22-alpine sh -c \
  "npm ci --no-audit --no-fund -q && npm run -s typecheck && npm test; chown -R $(id -u):$(id -g) /w/server"
docker build --build-arg BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest \
  --build-arg BUILD_ARCH=amd64 --build-arg BUILD_VERSION=test -t local/claude-ha:test .
```

The image build also runs the UI build and its type check. Regenerate a lockfile with the npm
in that same image, or a newer npm rewrites unrelated metadata (`libc`, `peer`). Nothing here
runs the add-on inside Home Assistant or on aarch64; say so rather than implying it.

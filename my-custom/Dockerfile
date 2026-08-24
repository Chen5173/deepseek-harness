# syntax=docker/dockerfile:1
#
# Oh-My-Dsh Web (DeepSeek Harness browser UI) Docker image.
# Build context = repo root (see my-custom/docker-compose.yml).
#
# Multi-stage: a full repo build (pnpm install + pnpm run build) in the build
# stage, then a slim runtime that runs `dsh web --host 0.0.0.0`.

# ── build stage ────────────────────────────────────────────────────────────
FROM node:22-slim AS build

# Native modules (node-pty, koffi, esbuild postinstall) need build tools + git.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable

# Whole repo source (node_modules / lib / dist are excluded via .dockerignore).
COPY . .

# Non-git build: pin the commit hash and Oh-My-Dsh build number so scripts
# never shell out to git (not present in the image).
ENV DSH_CLIENT_COMMIT_HASH=0000000
ENV DSH_OH_MY_DSH_BUILD=1.0.0

# China network: registry.npmjs.org direct is ~20-50 KiB/s and pnpm install
# times out; npmmirror (Taobao) mirrors every tarball at multi-MB/s. Only the
# build stage uses this; the runtime image never installs packages.
# NOTE: pnpm ignores the npm_config_registry env var (project/user .npmrc
# wins), so a project-level .npmrc is written before installing.
RUN corepack prepare pnpm@11.7.0 --activate \
  && printf 'registry=https://registry.npmmirror.com\n' > /app/.npmrc \
  && pnpm install --frozen-lockfile \
  && pnpm run build

# ── bake the web profile with the user's plugins ─────────────────────────
# my-custom/plugins-web is a copy of the host ~/.dsh/profiles/web manifest
# (bundles + dependency specs + pnpm-workspace.yaml); the local-disk plugin
# dsh-billing-balance is vendored under my-custom/vendor-plugins so its
# `file:` spec resolves inside the Linux build. pnpm runs in the profile dir,
# which has its OWN pnpm-workspace.yaml, so it is its own workspace root
# (never the repo's). The resulting node_modules are Linux-built (native
# deps correct for the runtime stage). The entrypoint copies this seed into
# $DSH_HOME on first run or whenever the seed hash changes.
RUN mkdir -p /app/dsh-seed/profiles \
  && cp -a my-custom/plugins-web /app/dsh-seed/profiles/web \
  && cp -a my-custom/vendor-plugins /app/dsh-seed/profiles/vendor-plugins \
  && cd /app/dsh-seed/profiles/web \
  && pnpm install \
  && (cat package.json pnpm-workspace.yaml | sha256sum | cut -d' ' -f1 > .dsh-seed-hash)

# ── runtime stage ──────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

WORKDIR /app
COPY --from=build /app ./
COPY --from=build /app/dsh-seed /app/dsh-seed
COPY my-custom/docker-entrypoint.sh /usr/local/bin/dsh-web-entrypoint.sh
RUN chmod +x /usr/local/bin/dsh-web-entrypoint.sh

ENV DSH_HOME=/data
ENV NODE_ENV=production
EXPOSE 3080

ENTRYPOINT ["/usr/local/bin/dsh-web-entrypoint.sh"]

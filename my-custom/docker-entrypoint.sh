#!/bin/sh
# dsh web entrypoint:
#   1. seeds $DSH_HOME/profiles/web with the plugins baked into the image
#      (my-custom/plugins-web, installed at build time in /app/dsh-seed)
#      on first run or whenever the seed hash changes, so the container
#      web app boots with the same plugin set as the host web profile;
#   2. forwards base web flags and appends --trusted-host only when
#      DSH_TRUSTED_HOST is set (compose can't conditionally omit a flag).
set -e

SEED_DIR=/app/dsh-seed/profiles/web
PROFILE_DIR="$DSH_HOME/profiles/web"

# ── 1. seed the web profile with baked-in plugins ─────────────────────────
# Copy the whole seed (package.json + pnpm-workspace.yaml + pnpm-lock.yaml +
# Linux-built node_modules) into the data volume when the volume profile is
# missing or carries an older seed hash. User-authored cordis.patch.yml /
# cordis.yml are preserved across a reseed (the seed ships the stock ones).
if [ -d "$SEED_DIR" ]; then
  seed_hash="$(cat "$SEED_DIR/.dsh-seed-hash" 2>/dev/null || echo none)"
  current_hash="$(cat "$PROFILE_DIR/.dsh-seed-hash" 2>/dev/null || echo none)"
  if [ ! -f "$PROFILE_DIR/package.json" ] || [ "$current_hash" != "$seed_hash" ]; then
    echo "[entrypoint] seeding web profile with baked plugins (hash $seed_hash)..."
    mkdir -p "$PROFILE_DIR"
    # preserve user-authored patch/config layers if they already exist
    for f in cordis.patch.yml cordis.yml; do
      if [ -f "$PROFILE_DIR/$f" ]; then
        cp "$PROFILE_DIR/$f" "$PROFILE_DIR/.$f.seed-bak"
      fi
    done
    cp -a "$SEED_DIR"/. "$PROFILE_DIR"/
    for f in cordis.patch.yml cordis.yml; do
      if [ -f "$PROFILE_DIR/.$f.seed-bak" ]; then
        mv "$PROFILE_DIR/.$f.seed-bak" "$PROFILE_DIR/$f"
      fi
    done
    printf "%s" "$seed_hash" > "$PROFILE_DIR/.dsh-seed-hash"
    echo "[entrypoint] web profile seeded."
  fi
fi

# ── 2. heal file permissions (Windows bind mounts copy files as 777) ──────
# dsh-credentials-local requires .credentials.yaml be owner-only (0600); a file
# copied from the Windows host lands as 0777 and the plugin tree refuses to boot.
# Fix perms here so any copy path (sync-config.sh, manual drops) is healed.
chmod 600 "$DSH_HOME/.credentials.yaml" 2>/dev/null || true
chmod 644 "$DSH_HOME/settings.yaml" 2>/dev/null || true

# ── 3. run dsh web ─────────────────────────────────────────────────────────
args="web --host 0.0.0.0 --port 3080 --no-open"
if [ -n "$DSH_TRUSTED_HOST" ]; then
  args="$args --trusted-host $DSH_TRUSTED_HOST"
fi

# shellcheck disable=SC2086
exec node /app/apps/cli/lib/bin.js $args

#!/usr/bin/env bash
# 把宿主机 ~/.dsh 的模型配置同步到 Docker 数据卷 dsh-data/，并重启 web 容器。
#
# 同步内容：
#   settings.yaml      模型提供方（llm-pi-ai.providers.*）+ 默认模型（agent-default-model）
#   .credentials.yaml  API key（DEEPSEEK_API_KEY / ARK_API_KEY / ... 等 refs）
#
# 用法：
#   bash my-custom/sync-config.sh          # 从 ~/.dsh 同步
#   DSH_DOT_DSH=/path/to/dsh bash my-custom/sync-config.sh   # 指定宿主机 dsh 家目录
# Windows 直接双击 my-custom/sync-config.bat
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
DATA_DIR="$SCRIPT_DIR/dsh-data"
HOST_DOT_DSH="${DSH_DOT_DSH:-$HOME/.dsh}"
WEB_CONTAINER=oh-my-dsh-web   # 容器名（docker ps 用）
WEB_SERVICE=dsh-web            # compose 服务名（restart 用）
TUNNEL_FILE="$SCRIPT_DIR/.dsh-tunnel-url"

say() { printf "%s\n" "$*"; }

if ! command -v docker >/dev/null 2>&1; then
  say "✗ 未找到 docker 命令，请先安装并启动 Docker。"
  exit 1
fi

if [ ! -f "$HOST_DOT_DSH/settings.yaml" ]; then
  say "✗ 宿主机没有 $HOST_DOT_DSH/settings.yaml（请确认 DSH_DOT_DSH 或 ~/.dsh 正确）。"
  exit 1
fi

mkdir -p "$DATA_DIR"

# ── 1. 模型配置 ──────────────────────────────────────────────
cp "$HOST_DOT_DSH/settings.yaml" "$DATA_DIR/settings.yaml"
say "✓ 已复制 settings.yaml（模型提供方 / 默认模型）"

# ── 2. API key（credentials refs）─────────────────────────────
if [ -f "$HOST_DOT_DSH/.credentials.yaml" ]; then
  cp "$HOST_DOT_DSH/.credentials.yaml" "$DATA_DIR/.credentials.yaml"
  say "✓ 已复制 .credentials.yaml（API key）"
else
  say "⚠ 宿主机没有 .credentials.yaml，未同步 key（容器里现有 key 不受影响）"
fi

# ── 3. 修正容器侧文件权限（Windows bind mount 复制出来是 777）────
# dsh-credentials-local 要求 .credentials.yaml 为 0600（owner-only），否则插件树
# 拒绝启动。宿主机 chmod 不会透传到容器，必须用一次性容器在挂载卷里 chmod。
# 容器镜像更新后 entrypoint 也会在每次启动时自愈，这里双保险。
if command -v cygpath >/dev/null 2>&1; then
  WIN_DATA="$(cygpath -w "$DATA_DIR")"
else
  WIN_DATA="$DATA_DIR"
fi
MSYS_NO_PATHCONV=1 docker run --rm --entrypoint sh \
  -v "$WIN_DATA:/data" oh-my-dsh-web:local \
  -c "chmod 600 /data/.credentials.yaml 2>/dev/null || true; chmod 644 /data/settings.yaml 2>/dev/null || true" \
  >/dev/null 2>&1 || true
say "✓ 已修正容器侧文件权限（credentials 0600 / settings 0644）"

# ── 4. 重新应用容器专属 remote-web-ui（免配对 + 公网 URL）──────
# 宿主机 settings.yaml 里 remote-web-ui.requirePairingForLan 缺省为 true、
# publicBaseUrl 可能是旧隧道地址；整文件复制会把这些带进容器，破坏免配对。
# 这里用 update-web-ui-settings.cjs 重新写回容器专属值。
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ -f "$SCRIPT_DIR/update-web-ui-settings.cjs" ]; then
  TUNNEL_URL="$(cat "$TUNNEL_FILE" 2>/dev/null || true)"
  if [ -n "$TUNNEL_URL" ]; then
    node "$SCRIPT_DIR/update-web-ui-settings.cjs" "$DATA_DIR/settings.yaml" "$TUNNEL_URL" "$REPO_ROOT" || true
  else
    node "$SCRIPT_DIR/update-web-ui-settings.cjs" "$DATA_DIR/settings.yaml" "" "$REPO_ROOT" || true
  fi
  say "✓ 已重新应用 remote-web-ui（免配对 + 公网 URL）"
fi

# ── 5. 重启 web 容器使配置生效 ────────────────────────────────
if docker ps -a --format '{{.Names}}' | grep -qx "$WEB_CONTAINER"; then
  say "▶ 重启 web 容器使配置生效 ..."
  docker compose -f "$COMPOSE_FILE" restart "$WEB_SERVICE" >/dev/null
  say "✓ 已重启 $WEB_CONTAINER"
else
  say "▶ web 容器未在运行；配置已就绪，运行 start-docker.bat 启动即可。"
fi

say ""
say "✓ 配置同步完成。模型：容器 llm-pi-ai 提供方已按宿主机配置生效。"

# ── 6. 打印登录信息（公网域名 + 授权码）──────────────────────
# 从持久化文件读取，跑完同步就能看到怎么远程登录。
say ""
say "📎 本机: http://127.0.0.1:3080"
if [ -f "$TUNNEL_FILE" ]; then
  PUBLIC_URL="$(cat "$TUNNEL_FILE")"
  say "📎 公网: $PUBLIC_URL"
else
  say "📎 公网: （未找到 .dsh-tunnel-url，先运行 start-docker.bat 启动）"
fi
if [ -f "$SCRIPT_DIR/.dsh-auth" ]; then
  AUTH_TOKEN="$(cat "$SCRIPT_DIR/.dsh-auth")"
  say "🔑 访问授权码: $AUTH_TOKEN （也存于 my-custom/.dsh-auth）"
else
  say "🔑 访问授权码: （未找到 .dsh-auth，先运行 start-docker.bat 生成）"
fi
say ""
say "远程登录：浏览器打开上面的公网地址 → 输入访问授权码 → 进入。"

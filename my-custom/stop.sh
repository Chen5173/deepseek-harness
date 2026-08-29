#!/usr/bin/env bash
# 停止 web 与公网隧道（保留 dsh-data/ 数据与 .dsh-auth 授权码）。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Compose 命令探测：优先 docker compose（v2），旧版 Docker 回退 docker-compose（v1）。
if docker --help 2>/dev/null | grep -qw compose; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  echo "✗ 未找到 docker compose（v2 插件）或 docker-compose 可执行文件。"
  exit 1
fi

echo "▶ 停止容器 ..."
"${COMPOSE_CMD[@]}" -f "$SCRIPT_DIR/docker-compose.yml" down
echo "已停止。数据保留在 my-custom/dsh-data/，授权码保留在 my-custom/.dsh-auth。"

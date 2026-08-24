#!/usr/bin/env bash
# 停止 web 与公网隧道（保留 dsh-data/ 数据与 .dsh-auth 授权码）。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "▶ 停止容器 ..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" down
echo "已停止。数据保留在 my-custom/dsh-data/，授权码保留在 my-custom/.dsh-auth。"

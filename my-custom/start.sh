#!/usr/bin/env bash
# 一键启动：构建镜像 → 启动公网隧道 → 启动 web → 打印本机/公网地址与访问授权码。
# 用法：  bash my-custom/start.sh        （或在 Git Bash / macOS / Linux 直接执行）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
ENV_FILE="$SCRIPT_DIR/.env"              # compose 自动读取的变量文件
AUTH_FILE="$SCRIPT_DIR/.dsh-auth"        # 授权码持久化（同 siyuan/.siyuan-auth）
TUNNEL_FILE="$SCRIPT_DIR/.dsh-tunnel-url" # 公网地址持久化
DATA_DIR="$SCRIPT_DIR/dsh-data"
WEB=oh-my-dsh-web
TUNNEL=oh-my-dsh-tunnel
PORT=3080

say() { printf '%s\n' "$*"; }

if ! command -v docker >/dev/null 2>&1; then
  say "✗ 未找到 docker 命令，请先安装并启动 Docker。"
  exit 1
fi

# Compose 命令探测：Docker 19.03+ 提供 `docker compose`（v2 插件）；
# 旧版（如 Docker Desktop 18.06，只有独立 docker-compose v1）没有该子命令，
# 直接调用 `docker compose -f ...` 会报 "unknown shorthand flag: 'f' in -f"，
# 因此按能力回退到 docker-compose，两种环境都能跑。
if docker --help 2>/dev/null | grep -qw compose; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  say "✗ 未找到 docker compose（v2 插件）或 docker-compose 可执行文件。"
  say "  请升级 Docker Desktop，或安装 docker-compose 后重试。"
  exit 1
fi
say "▶ 使用 Compose 命令：${COMPOSE_CMD[*]}"

# 等待 Docker daemon 就绪：Docker Desktop 启动后引擎要几十秒才可用，
# 刚启动完立刻运行脚本时 docker info 会误报“守护进程未运行”，
# 因此这里改为轮询等待（默认最多 90 秒），超时才报错。
# 若检测到运行在 WSL（bash 来自 C:\Windows\System32\bash.exe），
# 说明 start.sh 被 WSL 的 bash 执行了——WSL 里跑 Windows 的 docker.exe
# 连不上 Docker Desktop 引擎，失败时给出明确提示。
WSL_MODE=0
if [ -r /proc/version ] && grep -qi microsoft /proc/version 2>/dev/null; then
  WSL_MODE=1
fi

DAEMON_TIMEOUT="${DAEMON_TIMEOUT:-90}"
say "▶ 检查 Docker daemon（最多等待 ${DAEMON_TIMEOUT}s）..."
DAEMON_OK=0
for _ in $(seq 1 "$DAEMON_TIMEOUT"); do
  if docker info >/dev/null 2>&1; then
    DAEMON_OK=1
    break
  fi
  sleep 1
done
if [ "$DAEMON_OK" != 1 ]; then
  if [ "$WSL_MODE" = "1" ]; then
    say "✗ 当前运行在 WSL 环境（bash 来自 C:\Windows\System32\bash.exe）。"
    say "  在 WSL 里执行 Windows 的 docker.exe 连不上 Docker Desktop 引擎。"
    say "  请用 my-custom/start-docker.bat 启动（已改为显式调用 Git Bash），"
    say "  或在 Docker Desktop 设置里为对应发行版启用 WSL 集成。"
  else
    say "✗ 等待 ${DAEMON_TIMEOUT}s 后 Docker daemon 仍未就绪。"
    say "  请确认 Docker Desktop 已完全启动（托盘图标显示 Engine running），然后重试："
    say "  bash my-custom/start.sh"
  fi
  exit 1
fi

# 仅检查模式：验证 daemon 连通性后直接退出（供 start-docker.bat 自检/排障用）。
if [ "${DSH_CHECK_ONLY:-}" = "1" ]; then
  say "✓ Docker daemon 已就绪（DSH_CHECK_ONLY 模式，仅检查不启动）。"
  exit 0
fi

# ── 1. 访问授权码：首次生成，之后复用 ─────────────────────────
if [ -f "$AUTH_FILE" ]; then
  AUTH_TOKEN="$(cat "$AUTH_FILE")"
else
  AUTH_TOKEN="$(openssl rand -hex 16)"
  printf '%s' "$AUTH_TOKEN" > "$AUTH_FILE"
  say "▶ 已生成访问授权码并保存到 my-custom/.dsh-auth"
fi

# ── 2. 清理旧手工容器（不被 compose 管理） ──────────────────
for c in "$WEB" "$TUNNEL"; do
  if docker ps -a --format '{{.Names}}' | grep -qx "$c"; then
    if ! docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$c" 2>/dev/null | grep -q .; then
      say "▶ 检测到旧手工容器 $c，移除并交给 compose 管理（数据在 dsh-data/ 不受影响）"
      docker rm -f "$c" >/dev/null
    fi
  fi
done

# ── 3. 公网隧道：复用已运行隧道，否则启动并读取 URL ─────────
PUBLIC_URL=""

# 抓取隧道日志里最新的 trycloudflare URL（单次读取；重试由调用方循环负责，
# 因为引擎重启 / 容器重建瞬间 docker logs 可能短暂返回空）。
tunnel_url_from_logs() {
  # cloudflared 的日志走 stderr，必须 2>&1 才能拿到；以前用 2>/dev/null
  # 会把隧道地址一起丢掉（表现为“未能在 2 分钟内读到隧道地址”）。
  docker logs "$TUNNEL" 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true
}

tunnel_is_running() {
  docker ps --format '{{.Names}}' | grep -qx "$TUNNEL"
}

if tunnel_is_running; then
  PUBLIC_URL="$(tunnel_url_from_logs)"
  # 刚重启过的隧道要等 cloudflared 重新注册并把新地址写进日志；日志暂读不到
  # 就先短等一阵，再决定是否回退到记录文件（避免把过期地址当新地址用）。
  if [ -z "$PUBLIC_URL" ]; then
    for _ in $(seq 1 15); do
      sleep 2
      PUBLIC_URL="$(tunnel_url_from_logs)"
      [ -n "$PUBLIC_URL" ] && break
    done
  fi
  if [ -n "$PUBLIC_URL" ]; then
    printf '%s' "$PUBLIC_URL" > "$TUNNEL_FILE"
    say "⏭ 公网隧道已在运行"
  elif [ -f "$TUNNEL_FILE" ]; then
    PUBLIC_URL="$(cat "$TUNNEL_FILE")"
    say "⏭ 公网隧道已在运行（日志暂未读到地址，回退复用记录地址，可能已过期）"
  fi
fi

if [ -z "$PUBLIC_URL" ]; then
  say "▶ 启动公网隧道 ..."
  # 容器已在运行就不重复 compose up：避免因 .env 变化重建容器、清空日志，
  # 也避免白等一轮新的快速隧道地址。
  if ! tunnel_is_running; then
    # 先写含授权码的 .env（docker compose v2 从 compose 文件目录自动读取），
    # 隧道先起、web 后起，order 由本脚本控制。env 变量同时显式内联传入：
    # docker-compose v1 的 .env 按“当前工作目录”查找，从仓库根目录调用时
    # 读不到 my-custom/.env，不内联会得到空 DSH_WEB_AUTH_TOKEN。
    printf 'DSH_WEB_AUTH_TOKEN=%s\nDSH_TRUSTED_HOST=\n' "$AUTH_TOKEN" > "$ENV_FILE"
    DSH_WEB_AUTH_TOKEN="$AUTH_TOKEN" DSH_TRUSTED_HOST="" "${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" up -d cloudflared
  fi
  for _ in $(seq 1 60); do
    PUBLIC_URL="$(tunnel_url_from_logs)"
    [ -n "$PUBLIC_URL" ] && break
    sleep 2
  done
  if [ -n "$PUBLIC_URL" ]; then
    printf '%s' "$PUBLIC_URL" > "$TUNNEL_FILE"
  else
    say "⚠ 未能在 2 分钟内读到隧道地址，请稍后查看 docker logs $TUNNEL"
  fi
fi
TUNNEL_HOST="${PUBLIC_URL#https://}"

# ── 4. 写最终 .env 并启动 web（容器已存在则直接启动） ────────
printf 'DSH_WEB_AUTH_TOKEN=%s\nDSH_TRUSTED_HOST=%s\n' "$AUTH_TOKEN" "$TUNNEL_HOST" > "$ENV_FILE"

# ── 3.5 同步公网配对来源（remote-web-ui.publicBaseUrl）────────
# 容器内 /api/pair/* 只信任 回环 + 局域网 + publicBaseUrl；不更新的话公网设备
# 会一直显示“此设备未配对”。URL 变化会同时改写 .env 的 DSH_TRUSTED_HOST，
# compose 检测到配置变化会自动重建 web 容器，让新值随启动生效。
if [ -n "$PUBLIC_URL" ] && [ -f "$SCRIPT_DIR/update-web-ui-settings.cjs" ]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  if node "$SCRIPT_DIR/update-web-ui-settings.cjs" "$DATA_DIR/settings.yaml" "$PUBLIC_URL" "$REPO_ROOT"; then
    say "▶ 已同步公网配对来源: $PUBLIC_URL"
  else
    say "⚠ 同步 remote-web-ui.publicBaseUrl 失败（不影响启动）"
  fi
fi

if docker ps -a --format '{{.Names}}' | grep -qx "$WEB"; then
  say "▶ 容器已存在，启动 ..."
else
  say "▶ 用 docker-compose 启动 ..."
fi
# 旧版 Docker（走到 docker-compose v1 回退说明没有 compose v2）的默认 seccomp
# 会拦截 clone3，现代 glibc 镜像里 node/pnpm 无法创建线程（uv_thread_create
# assertion / pthread_create EPERM）。镜像缺失时用 --security-opt seccomp=unconfined
# 手动构建；compose 发现镜像已存在就不再重复 build。现代 Docker 走 docker compose
# 分支，不触发这里。
if [ "${COMPOSE_CMD[0]}" = "docker-compose" ] && ! docker image inspect "$WEB:local" >/dev/null 2>&1; then
  say "▶ 构建镜像（旧版 Docker 尝试 seccomp=unconfined，需要几分钟）..."
  if ! docker build --security-opt seccomp=unconfined -f "$SCRIPT_DIR/Dockerfile" -t "$WEB:local" "$SCRIPT_DIR/.."; then
    say "⚠ seccomp=unconfined 构建不可用（本机 daemon 不支持 build security options）"
    say "  回退到默认 docker build；若 Docker 过旧（<20.10）且镜像基于现代 glibc，"
    say "  node/pnpm 会因 clone3 被 seccomp 拦截而崩溃（uv_thread_create / EPERM）。"
    say "  请升级 Docker Desktop，或在 my-custom/README.md 查看本机适配说明。"
    docker build -f "$SCRIPT_DIR/Dockerfile" -t "$WEB:local" "$SCRIPT_DIR/.."
  fi
fi
DSH_WEB_AUTH_TOKEN="$AUTH_TOKEN" DSH_TRUSTED_HOST="$TUNNEL_HOST" "${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" up -d dsh-web

# ── 5. 等待 web 就绪 ────────────────────────────────────────
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# ── 6. 打印访问信息 ─────────────────────────────────────────
say ""
say "📎 本机: http://127.0.0.1:$PORT"
if [ -n "$PUBLIC_URL" ]; then
  say "📎 公网: $PUBLIC_URL"
else
  say "📎 公网: （未获取到，隧道可能未就绪）"
fi
say "🔑 访问授权码: $AUTH_TOKEN （也存于 my-custom/.dsh-auth）"
say ""
say "停止： bash my-custom/stop.sh"

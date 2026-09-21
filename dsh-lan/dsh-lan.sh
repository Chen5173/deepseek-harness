#!/usr/bin/env bash
# dsh-lan.sh —— 让 DSH Web GUI 可以从局域网用 ip:端口 访问（macOS / Linux / WSL / Git Bash）
#
# 为什么需要一个转发器，而不是直接绑 0.0.0.0：
#   1. 上游故意拒绝 `dsh web --host 0.0.0.0`（会把本机 RCE 暴露到网络），
#      且 webserver 的 host 只接受 127.0.0.1 | 0.0.0.0；
#   2. 受支持的形态是：GUI 继续绑回环 + 本机另起一个局域网监听转发到回环，
#      并让 `--trusted-host <本机局域网IP>` 通过 /api 的 Host/Origin 信任栅栏；
#   3. 认证完全不变：DSH 用「每个进程一个启动 token」换 HttpOnly cookie。
#
# token 怎么办（不用在手机上手输）：
#   token 只存在于 GUI 进程的输出里，所以本脚本把 GUI 的 stdout 落到一个日志文件，
#   再让转发器用 --token-file 去读它：转发器会自己打印带 token 的完整局域网 URL；
#   加 --auto-login 后，转发器还会把「未认证的页面导航」用 303 直接送到 /?token=...，
#   于是手机打开裸地址就自动登录。--auto-login 等于把会话交给所有能连上该端口的人，
#   因此它必须限定来源：--allow <ip[,ip|cidr]> 或显式 --any-source。
#
# 用法（细节见同目录 README.md）：
#   ./dsh-lan.sh                                       起 GUI（自动 --trusted-host）+ 纯转发
#   ./dsh-lan.sh --auto-login --allow 10.228.0.0/16   手机打开裸地址即可，无需 token
#   ./dsh-lan.sh --bridge-only                         只起转发（GUI 已在跑）
#   ./dsh-lan.sh --bridge-only --rewrite-host          只起转发 + 改写 Host
#   ./dsh-lan.sh --gui-only                            只起 GUI
#   ./dsh-lan.sh --dry-run                             只打印将执行的命令
#   ./dsh-lan.sh -- <dsh 参数>                         `--` 之后原样透传给 dsh CLI
# 首次使用：chmod +x dsh-lan.sh
set -euo pipefail

PORT=3081
LAN_PORT=3082
LAN_IP=
REPO=
ALLOW=
TOKEN=
TOKEN_FILE=
REWRITE=0
NO_GUI=0
GUI_ONLY=0
DRY_RUN=0
AUTO_LOGIN=0
ANY_SOURCE=0
DSH_ARGS=()

usage() {
  cat <<'USAGE'
用法: ./dsh-lan.sh [选项] [-- dsh 参数...]

  不带选项                启动 GUI（带 --trusted-host 本机局域网IP）+ 纯转发
  --auto-login            转发器自动完成 token 交换：浏览器打开裸地址即登录
  --allow <列表>          来源白名单（逗号分隔，支持单个 IP 或 CIDR），例如 10.228.0.0/16
  --any-source            显式接受「所有能连上的来源」都能拿到会话（配合 --auto-login）
  --bridge-only           只起转发器（GUI 已在别处运行；别名 --no-gui）
                          （不带这些开关也行：检测到回环端口已有 GUI 就不重复启动）
  --gui-only              只起 GUI
  --rewrite-host          改用“改写 Host”模式（GUI 没带 --trusted-host 时用；别名 --rewrite）
  --port <N>              GUI 监听端口（回环），默认 3081
  --lan-port <N>          局域网监听端口，默认 3082
  --lan-ip <IP>           指定对外 IP，默认自动探测第一个非回环 IPv4
  --token <token>         直接给出 GUI 的启动 token（只起转发器时用）
  --token-file <路径>     从文件里读 token（默认：本脚本自己 tee 出来的 GUI 输出）
  --repo <路径>           DSH 仓库根目录，默认从本脚本位置向上查找 apps/cli/lib/bin.js
  --dry-run               只打印将执行的命令
  -h, -Help, --help       显示本帮助（/? 、help 同样可以）

示例:
  ./dsh-lan.sh
  ./dsh-lan.sh --auto-login --allow 10.228.0.0/16
  ./dsh-lan.sh --lan-port 3092            # 换局域网监听端口
  ./dsh-lan.sh --auto-login --allow 10.228.8.25,10.224.50.9
  ./dsh-lan.sh --bridge-only --token-file ~/gui.log --auto-login --allow 192.168.1.0/24
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --bridge-only | --no-gui) NO_GUI=1 ;;
    --rewrite-host | --rewrite) REWRITE=1 ;;
    --gui-only) GUI_ONLY=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --auto-login) AUTO_LOGIN=1 ;;
    --any-source) ANY_SOURCE=1 ;;
    --port) PORT="${2:-}"; shift ;;
    --lan-port) LAN_PORT="${2:-}"; shift ;;
    --lan-ip) LAN_IP="${2:-}"; shift ;;
    --allow) ALLOW="${2:-}"; shift ;;
    --repo) REPO="${2:-}"; shift ;;
    --token) TOKEN="${2:-}"; shift ;;
    --token-file) TOKEN_FILE="${2:-}"; shift ;;
    -h | --help | -Help | help) usage; exit 0 ;;
    --) shift; DSH_ARGS=("$@"); break ;;
    *) echo "[dsh-lan] 未知参数: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

case "$PORT" in
  '' | *[!0-9]*)
    echo "[dsh-lan] --port 需要一个数字，收到: $PORT" >&2
    exit 2
    ;;
esac
case "$LAN_PORT" in
  '' | *[!0-9]*)
    echo "[dsh-lan] --lan-port 需要一个数字，收到: $LAN_PORT" >&2
    exit 2
    ;;
esac

if [ "$AUTO_LOGIN" -eq 1 ] && [ -z "$ALLOW" ] && [ "$ANY_SOURCE" -eq 0 ]; then
  echo "[dsh-lan] --auto-login 会把会话交给所有能连上该端口的人；" >&2
  echo "          请用 --allow <ip[,ip|cidr]> 限定来源，或用 --any-source 明确接受这一点。" >&2
  exit 2
fi

# ---- 定位脚本所在目录（解析软链接，任意 cwd 都可用）----
script_path=${BASH_SOURCE[0]:-$0}
while [ -L "$script_path" ]; do
  link_dir=$(cd -P "$(dirname "$script_path")" && pwd)
  script_path=$(readlink "$script_path")
  case $script_path in
    /*) ;;
    *) script_path=$link_dir/$script_path ;;
  esac
done
self_dir=$(cd -P "$(dirname "$script_path")" && pwd)

# ---- 找到 DSH 仓库根（里面有 apps/cli/lib/bin.js）----
# 仓库在哪：--repo 优先，其次 DSH_REPO、上次记住的 dsh-lan.repo（只在它真的指向一个
# 含 apps/cli/lib/bin.js 的目录时才用）、DSH_HOME 的父目录，最后才从脚本位置向上找。
# 解析出来的路径会被记住，所以 --repo 只需给一次。
repo_file=$self_dir/dsh-lan.repo
if [ -z "$REPO" ] && [ -n "${DSH_REPO:-}" ]; then
  REPO=$DSH_REPO
fi
if [ -z "$REPO" ] && [ -f "$repo_file" ]; then
  saved=$(cat "$repo_file")
  if [ -n "$saved" ] && [ -f "$saved/apps/cli/lib/bin.js" ]; then REPO=$saved; fi
fi
if [ -z "$REPO" ] && [ -n "${DSH_HOME:-}" ]; then
  candidate=$(dirname "$DSH_HOME")
  if [ -f "$candidate/apps/cli/lib/bin.js" ]; then REPO=$candidate; fi
fi
if [ -z "$REPO" ]; then
  probe=$self_dir
  steps=0
  while [ "$steps" -lt 6 ]; do
    if [ -f "$probe/apps/cli/lib/bin.js" ]; then REPO=$probe; break; fi
    up=$(cd -P "$probe/.." && pwd)
    if [ "$up" = "$probe" ]; then break; fi
    probe=$up
    steps=$((steps + 1))
  done
fi
if [ -n "$REPO" ]; then printf %s "$REPO" > "$repo_file" 2>/dev/null || true; fi
if [ -z "$REPO" ] || [ ! -f "$REPO/apps/cli/lib/bin.js" ]; then
  echo "[dsh-lan] 找不到 DSH 仓库根目录（需要包含 apps/cli/lib/bin.js）。" >&2
  echo "          请用 --repo <路径> 或环境变量 DSH_REPO 指定。" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[dsh-lan] PATH 里找不到 node，请先安装 Node.js。" >&2
  exit 1
fi

# ---- 本机局域网 IP（由 lan-bridge.mjs 统一探测，两个平台同一份逻辑）----
if [ -z "$LAN_IP" ]; then
  LAN_IP=$(node "$self_dir/scripts/lan-bridge.mjs" --print-lan-ip 2>/dev/null || true)
fi
if [ -z "$LAN_IP" ]; then
  echo "[dsh-lan] 未能自动探测局域网 IPv4，请用 --lan-ip <IP> 指定。" >&2
  exit 1
fi

# 已经有 GUI 在回环端口上？不要重复起一个，改为只起转发器。
if [ "$GUI_ONLY" -eq 0 ] && [ "$NO_GUI" -eq 0 ] && [ "$REWRITE" -eq 0 ]; then
  if (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null; then
    exec 3>&- 2>/dev/null || true
    NO_GUI=1
    echo "[dsh-lan] 检测到 127.0.0.1:$PORT 上已有 GUI 在跑；不重复启动，改为只起转发器。"
  fi
fi

# ---- 组装命令 ----
export DSH_HOME="$REPO/.dsh_home"

# GUI 输出落到临时日志，转发器从中读取启动 token（并可把日志回显出来）
GUI_LOG=${TOKEN_FILE:-}
if [ -z "$GUI_LOG" ]; then
  GUI_LOG=$(mktemp "${TMPDIR:-/tmp}/dsh-lan-gui.XXXXXX")
fi

if [ "${#DSH_ARGS[@]}" -gt 0 ]; then
  GUI_ARGS=("${DSH_ARGS[@]}")
else
  GUI_ARGS=(web --no-open --port "$PORT" --trusted-host "$LAN_IP")
fi
if [ -f "$REPO/dsh-start.sh" ]; then
  GUI_CMD=(bash "$REPO/dsh-start.sh" "${GUI_ARGS[@]}")
else
  GUI_CMD=(node "$REPO/apps/cli/lib/bin.js" "${GUI_ARGS[@]}")
fi

BRIDGE_CMD=(node "$self_dir/scripts/lan-bridge.mjs" --lan-port "$LAN_PORT" --target "127.0.0.1:$PORT")
if [ "$REWRITE" -eq 1 ]; then
  BRIDGE_CMD+=(--rewrite-host)
fi
# token 来源：显式 --token 优先；否则用本脚本自己接管的 GUI 日志（默认模式），
# 或者用户 --token-file 指定的文件。只起转发又没给 token 来源时不猜、不刷屏，
# 与 Windows 的 start-lan-bridge.cmd 行为一致。
if [ -n "$TOKEN" ]; then
  BRIDGE_CMD+=(--token "$TOKEN")
elif [ -n "$TOKEN_FILE" ]; then
  BRIDGE_CMD+=(--token-file "$GUI_LOG" --echo-log)
elif [ "$NO_GUI" -eq 0 ] && [ "$REWRITE" -eq 0 ]; then
  BRIDGE_CMD+=(--token-file "$GUI_LOG" --echo-log)
fi
if [ -n "$ALLOW" ]; then
  BRIDGE_CMD+=(--allow "$ALLOW")
fi
if [ "$AUTO_LOGIN" -eq 1 ]; then
  BRIDGE_CMD+=(--auto-login)
fi
if [ "$ANY_SOURCE" -eq 1 ]; then
  BRIDGE_CMD+=(--any-source)
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dsh-lan] dry-run："
  echo "  repo      = $REPO"
  echo "  lan ip    = $LAN_IP"
  echo "  gui port  = $PORT"
  echo "  lan port  = $LAN_PORT"
  echo "  DSH_HOME  = $DSH_HOME"
  echo "  gui log   = $GUI_LOG"
  echo "  GUI:    ${GUI_CMD[*]}"
  echo "  bridge: ${BRIDGE_CMD[*]}"
  exit 0
fi

if [ "$GUI_ONLY" -eq 1 ]; then
  echo "[dsh-lan] 只启动 GUI；局域网访问还需要另起转发器（./dsh-lan.sh --no-gui）。"
  exec "${GUI_CMD[@]}"
fi

if [ "$NO_GUI" -eq 1 ] || [ "$REWRITE" -eq 1 ]; then
  if [ "$REWRITE" -eq 0 ]; then
    trust=$(node "$self_dir/scripts/lan-bridge.mjs" --probe-trust "$LAN_IP:$LAN_PORT" --target "127.0.0.1:$PORT" 2>/dev/null || true)
    if [ "$trust" = "untrusted" ]; then
      echo "[dsh-lan] 警告：127.0.0.1:$PORT 上的 GUI 还没信任 $LAN_IP，/api 会返回 403。" >&2
      echo "          加 --rewrite-host，或用本脚本重启 GUI（它会带 --trusted-host）。" >&2
    elif [ "$trust" = "unreachable" ]; then
      echo "[dsh-lan] 警告：127.0.0.1:$PORT 上没有服务在监听，请先起 GUI。" >&2
    fi
  fi
  if [ -z "$TOKEN" ] && [ -z "$TOKEN_FILE" ]; then
    echo "[dsh-lan] 提示：GUI 不是本脚本起的，拿不到它的启动 token；想让手机免 token，请加 --token/--token-file，再配 --auto-login --allow <来源>。"
  fi
  if [ "$REWRITE" -eq 1 ]; then
    echo "[dsh-lan] 转发器：改写 Host 模式（会绕过 /api 的 Host 栅栏，认证仍然生效）"
  else
    echo "[dsh-lan] 转发器：纯转发模式（要求 GUI 已用 --trusted-host $LAN_IP 启动）"
  fi
  echo "[dsh-lan] 局域网入口： http://$LAN_IP:$LAN_PORT/"
  exec "${BRIDGE_CMD[@]}"
fi

# ---- 默认模式：GUI 后台跑 + 转发器前台跑，Ctrl+C 一起退出 ----
GUI_PID=
cleanup() {
  if [ -n "$GUI_PID" ] && kill -0 "$GUI_PID" 2>/dev/null; then
    echo "[dsh-lan] 停止 GUI (pid $GUI_PID)"
    kill "$GUI_PID" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

echo "[dsh-lan] 启动 GUI： ${GUI_CMD[*]}"
echo "[dsh-lan] GUI 输出同时写入： $GUI_LOG"
"${GUI_CMD[@]}" >>"$GUI_LOG" 2>&1 &
GUI_PID=$!

# 等回环端口就绪（最多约 60 秒），避免一上来就 502；用 bash 的 /dev/tcp，无需额外依赖
ready=0
tries=0
while [ "$tries" -lt 200 ]; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
    exec 3>&- 2>/dev/null || true
    ready=1
    break
  fi
  if ! kill -0 "$GUI_PID" 2>/dev/null; then break; fi
  sleep 0.3
  tries=$((tries + 1))
done
if [ "$ready" -eq 1 ]; then
  echo "[dsh-lan] GUI 已就绪: 127.0.0.1:$PORT"
else
  echo "[dsh-lan] 警告：等待 GUI 端口超时，仍继续启动转发器。" >&2
fi
if ! kill -0 "$GUI_PID" 2>/dev/null; then
  echo "[dsh-lan] 警告：GUI 进程已退出（3081 可能已被另一个 GUI 占用）。" >&2
  echo "          这种情况请保留那个 GUI，改用：./dsh-lan.sh --bridge-only（必要时再加 --rewrite-host）" >&2
fi

echo "[dsh-lan] 局域网入口： http://$LAN_IP:$LAN_PORT/"
if [ "$AUTO_LOGIN" -eq 1 ]; then
  echo "[dsh-lan] auto-login 已开：手机直接打开上面的地址即可，无需 token。"
else
  echo "[dsh-lan] 转发器稍后会打印带 token 的完整 URL（在手机浏览器里打开一次即可）。"
fi
"${BRIDGE_CMD[@]}"

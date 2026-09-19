#!/usr/bin/env bash
# dsh-start.sh —— dsh-start.ps1 的 shell 版本（Linux / macOS / WSL / Git Bash）。
#
# 与 PowerShell 版本行为一致：
#   1. 把 DSH_HOME 指向本仓库内的 .dsh_home（不是用户级 ~/.dsh）；
#   2. 首次运行时若仓库内还没有 sessions、而 ~/.dsh/sessions 存在，就把它链接过来，
#      让仓库级 home 复用已有会话（PS 版本靠提权建符号链接，这里优先用免提权的目录联接）；
#   3. 不带参数启动 Web GUI（web --no-open --port 3081），带参数则原样透传给 dsh CLI。
#
# 用法：./dsh-start.sh            # 启动 Web GUI，固定 3081 端口
#       ./dsh-start.sh --help     # 其余参数全部交给 dsh CLI
# 首次使用：chmod +x dsh-start.sh
set -euo pipefail

# ---- 定位脚本所在目录（解析软链接，任意 cwd、任意方式调用都可用）----
script_path=${BASH_SOURCE[0]:-$0}
while [ -L "$script_path" ]; do
  link_dir=$(cd -P "$(dirname "$script_path")" && pwd)
  script_path=$(readlink "$script_path")
  case $script_path in
    /*) ;;
    *) script_path=$link_dir/$script_path ;;
  esac
done
cur_dir=$(cd -P "$(dirname "$script_path")" && pwd)

export DSH_HOME="$cur_dir/.dsh_home"

# ---- 判断是否需要同步会话 ----
sessions_dir="$DSH_HOME/sessions"
legacy_sessions="$HOME/.dsh/sessions"

if [ ! -d "$sessions_dir" ] && [ -d "$legacy_sessions" ]; then
  echo "[dsh-start] 链接会话目录: $sessions_dir -> $legacy_sessions"
  mkdir -p "$DSH_HOME"

  # Windows 侧 shell（Git Bash / MSYS / Cygwin / WSL）与真实 Unix 的处理方式不同
  on_windows=''
  case "$(uname -s 2>/dev/null)" in
    MINGW* | MSYS* | CYGWIN*) on_windows=1 ;;
  esac
  if [ -n "${WSL_DISTRO_NAME:-}" ]; then on_windows=1; fi

  if [ -n "$on_windows" ]; then
    # Windows 上建符号链接需要管理员或开发者模式；目录联接（junction）不需要任何提权，
    # 对应 PS 版本里 Start-Process -Verb RunAs 的那一步。
    win_path() {
      if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"
      elif command -v wslpath >/dev/null 2>&1; then wslpath -m "$1"
      else printf '%s' "$1"
      fi
    }
    if command -v powershell.exe >/dev/null 2>&1; then
      powershell.exe -NoProfile -Command \
        "New-Item -ItemType Junction -Path '$(win_path "$sessions_dir")' -Target '$(win_path "$legacy_sessions")' | Out-Null" \
        || true
    fi
    # 保底：MSYS/Cygwin 下 ln -s（WSL 的 drvfs 亦可）
    if [ ! -d "$sessions_dir" ]; then
      ln -s "$legacy_sessions" "$sessions_dir" 2>/dev/null || true
    fi
    if [ ! -d "$sessions_dir" ]; then
      echo "[dsh-start] 警告：未能建立会话链接，将使用独立的 $sessions_dir。" >&2
      echo "           可手动执行（管理员 PowerShell）：New-Item -ItemType SymbolicLink -Path '$(win_path "$sessions_dir")' -Target '$(win_path "$legacy_sessions")'" >&2
    fi
  else
    ln -s "$legacy_sessions" "$sessions_dir" ||
      echo "[dsh-start] 警告：创建符号链接失败，将使用独立的 $sessions_dir。" >&2
  fi
fi

# ---- 启动 ----
cli="$cur_dir/apps/cli/lib/bin.js"
if ! command -v node >/dev/null 2>&1; then
  echo "[dsh-start] PATH 中找不到 node，请先安装 Node.js。" >&2
  exit 1
fi
if [ ! -f "$cli" ]; then
  echo "[dsh-start] 找不到 CLI 产物：$cli" >&2
  echo "           请先在仓库根目录执行 pnpm install && pnpm build。" >&2
  exit 1
fi

if [ "$#" -eq 0 ]; then
  exec node "$cli" web --no-open --port 3081
else
  exec node "$cli" "$@"
fi

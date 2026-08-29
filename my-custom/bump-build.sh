#!/usr/bin/env bash
# 发版/push 前手动 bump 一次个人定制 build 版本（patch +1）。
# 版本存于 my-custom/oh-my-dsh-build.txt；Web / CLI 品牌（cv.X.Y.Z）都读它，
# 不再随 commit 数自动增长——commit 不改变版本号，只有本脚本手动 +1。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION_FILE="$SCRIPT_DIR/oh-my-dsh-build.txt"

if [ ! -f "$VERSION_FILE" ]; then
  echo "✗ 找不到 $VERSION_FILE" >&2
  exit 1
fi

VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]{1,6}$ ]]; then
  echo "✗ $VERSION_FILE 内容必须是 X.Y.Z（当前：$VERSION）" >&2
  exit 1
fi

IFS='.' read -r MAJOR MINOR PATCH <<< "$VERSION"
NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
printf '%s\n' "$NEW_VERSION" > "$VERSION_FILE"
echo "✓ 版本号：cv.$VERSION → cv.$NEW_VERSION"
echo "  提交信息首行可写：【个人定制版本号】: cv.$NEW_VERSION"

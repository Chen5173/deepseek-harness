#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批量把目录下的 PNG 转成 ICO（多尺寸嵌入，适合 Windows 图标）。

用法示例:
    python png2ico.py                      # 转换当前目录所有 png
    python png2ico.py ./icons -r           # 递归转换 icons 下所有 png
    python png2ico.py ./icons -o ./out     # 输出到指定目录
    python png2ico.py ./icons --overwrite  # 覆盖已存在的 .ico
"""
import argparse
import sys
from pathlib import Path

from PIL import Image

DEFAULT_SIZES = [16, 24, 32, 48, 64, 128, 256]


def convert(src: Path, dst: Path, sizes: list) -> None:
    with Image.open(src) as im:
        im = im.convert("RGBA")  # 保留透明通道
        im.save(dst, format="ICO", sizes=[(s, s) for s in sizes])


def main() -> int:
    ap = argparse.ArgumentParser(description="把目录下的 PNG 转为 ICO")
    ap.add_argument("dir", nargs="?", default=".", help="目标目录（默认当前目录）")
    ap.add_argument("-r", "--recursive", action="store_true", help="递归子目录")
    ap.add_argument("-o", "--outdir", default=None, help="输出目录（默认与源图同目录）")
    ap.add_argument("--overwrite", action="store_true", help="覆盖已存在的 .ico（默认跳过）")
    ap.add_argument("--sizes", default=",".join(map(str, DEFAULT_SIZES)),
                    help="嵌入尺寸，逗号分隔（默认 16,24,32,48,64,128,256）")
    args = ap.parse_args()

    try:
        sizes = [int(s) for s in args.sizes.split(",") if s.strip()]
    except ValueError:
        print("[错误] --sizes 必须是逗号分隔的数字", file=sys.stderr)
        return 1
    if not sizes:
        print("[错误] 没有有效的尺寸", file=sys.stderr)
        return 1

    root = Path(args.dir)
    if not root.is_dir():
        print(f"[错误] 目录不存在: {root}", file=sys.stderr)
        return 1

    files = sorted(root.rglob("*.png")) if args.recursive else sorted(root.glob("*.png"))
    if not files:
        print(f"[提示] 目录下没有 PNG 文件: {root}")
        return 0

    ok = skipped = failed = 0
    for src in files:
        if args.outdir:
            dst = Path(args.outdir) / (src.stem + ".ico")
        else:
            dst = src.with_suffix(".ico")
        if dst.exists() and not args.overwrite:
            skipped += 1
            print(f"[跳过] {dst}（已存在，加 --overwrite 覆盖）")
            continue
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            convert(src, dst, sizes)
            ok += 1
            print(f"[OK] {src} -> {dst} ({len(sizes)} sizes)")
        except Exception as e:
            failed += 1
            print(f"[失败] {src} -> {e}", file=sys.stderr)

    print(f"完成: 转换 {ok} 个，跳过 {skipped} 个，失败 {failed} 个")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

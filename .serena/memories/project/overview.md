# 项目概览 (DeepSeek Harness / dsh)

- 仓库根：`C:\Nt\dsh`。产品：DeepSeek Harness（dsh），DeepSeek AI 开源的 agent harness，架构为 “everything is a plugin”，基于 Cordis（vendor/cordis）。
- 版本 `0.1.2-rc.1`；包管理器 pnpm@11.7.0 workspaces；engines `node ^22.19.0 || >=24.0.0`；全仓 ESM（`"type": "module"`）。
- 仓库状态：developer preview，明确声明会有破坏性兼容变更；发布前允许重命名/重打包，后端拒绝旧磁盘格式（SQLite 单调 `SCHEMA_VERSION`；`dsh-session` 的 `SESSION_FORMAT_VERSION` 保持 0，无兼容承诺）。

## 顶层布局

| 目录 | 内容 |
|---|---|
| `vendor/` | vendored Cordis 源码（cordis, cosmokit, loader, hmr, group, include, schemastery, timer, logger-console）|
| `packages/<group>/<pkg>/` | 51 个 group、249 个包（peer 图节点数）；`@deepseek-ai/dsh-<name>` |
| `apps/cli/` | `dsh` CLI（bin: `lib/bin.js`；源码入口 `src/bin.ts`）|
| `apps/web/` | Web GUI 的 Vite 前端（`@deepseek-ai/dsh-web-frontend`）|
| `python/` | Python SDK（`python/sdk`）与打包运行时（`python/sdk-runtime`）|
| `native/landlock-run/` | `@deepseek-ai/node-addon-landlock-run`（Linux 沙箱 Node addon 源）|
| `docs/` | 架构、子系统页、catalog、cookbook（bilingual，见 `docs/AGENTS.md`）|
| `website/` | VitePress 文档站（`@deepseek-ai/website`）|
| `scripts/` | 仓库 gate 与生成器（`run-gates.ts`、`gen-module-graph.ts` 等）|
| `snapshots/` | 无 key 录制的会话回放快照|
| `examples/`, `analysis/` | 示例与产物|

## 仓库来源

- `origin` = github.com/Chen5173/deepseek-harness（个人 fork）
- `upstream` = github.com/deepseek-ai/deepseek-harness（官方）

## 证据

- `README.md`、`AGENTS.md`、`package.json`、`packages/README.md`、`docs/architecture.md`、`ls` 实测。

# 工具导航与已知坑（Codemap / Serena）

## Serena

- 项目名 `dsh`（`C:\Nt\dsh`）。新会话需先 `activate_project("dsh")`，否则 `get_current_config` 报 "No active project"。
- 后端 LSP，`language_servers: typescript`，状态 ready。**Serena 返回的行号是 0-based。**
- 首次建模（本仓库第一批记忆写入）时 onboarding 未执行，`list_memories` 原为空；现有 `project/*` 记忆由该会话手写。
- 已实测可用：`get_symbols_overview`（如 `packages/core/session/src/types.ts` 的 `SessionEventMap`/`SESSION_FORMAT_VERSION`）、`find_symbol`、`find_referencing_symbols`、`write_memory`、`list_memories`。

## Codemap

- **Codemap 可用**，但有两类必须绕开的坑：

### 坑 1：根级扫描超时（噪声，不是工具坏了）
- `packages/` 单个目录实测 11,234 个文件 / 90.3MB，其中 `.ts` 只有 3,955（其余为构建出的 `lib/`、`.map`、`.js`）；仓库根另有 `.dsh-build/`、`*.tsbuildinfo` 构建残留。
- 表现：`get_handoff`（仓库根）/`get_structure`（根）会 `Request timed out`（-32001）。
- 对策：把 `path` 收窄到包组或子目录。实测 `packages/core` 的 `get_hubs` 秒回（`session/src/types.ts`、`tools/src/index.ts` 等枢纽），`get_handoff` 也可用。

### 坑 2：`get_handoff` 默认 `ref` 是 `main`，但本仓库默认分支是 `master`
- 不传 `ref` 时报错 `Failed to build handoff: failed to compute changed files: exit status 128`。
- 实测：本仓库只有 `master`（`upstream/HEAD -> refs/remotes/upstream/master`），没有 `main`。
- 对策：调用时显式传 `ref: "master"`。

### `get_topology` 不可用
- 在本仓库返回 `coverage: {status: "unavailable"}`，nodes/dependencies/dependents 全为空 —— 不要依赖它做依赖分析。
- 替代（权威）：仓库自带的生成物 `docs/module-graph.md`（1391 行 mermaid peer 图，`pnpm run gen-module-graph` 生成，CI 校验新鲜度）。

### 配置只提不改
- 仓库**不存在** `.codemap/config.json`。按工作流规则只能提出配置计划，不得自动创建/改写；降噪需同时设置 `only`（源码扩展名白名单，如 `.ts/.md/.json`）与 `exclude`（排除 `lib/`、`dist/`、`*.map`、`node_modules`、`.dsh-build/` 等确定无价值目录），并保护 `.github`、`.serena`、`.codemap`、`vendor`；禁止用 `.*`/`**/.*`，也禁止对 `tmp`、`build` 一刀切。

### 分层用法（已验证有效）
- Codemap 缩小到**模块/文件**；Serena 再缩小到**符号**。根级不可用时依赖/影响面结论一律标 `partial`，`get_hubs` 对动态导入/反射/生成代码不可见，相关结论标“待验证”。

## 忽略/未跟踪
- `.gitignore` 只忽略 `.dsh-build/`、`.agents/worktrees/`；`.serena/` 与 `.codemap/`（Handoff 产物）**未被忽略**，会出现在 `git status` 的 untracked 中。

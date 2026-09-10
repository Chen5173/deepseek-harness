# 架构与启动装配（dsh）

权威文档：`docs/architecture.md`（改 `packages/` 前必读）、`docs/cordis-primer.md`、`docs/agent-lifecycle.md`、`docs/event-producer-consumer.md`、`packages/README.md`。

## 组合模型：profile + bundle + patch 层

运行中的 `dsh` 是启动时按有序层组装出的 Cordis 插件树：

1. profile（存于 Harness home，用户配置）按顺序列出它 stack 的 bundle；
2. 每个 bundle 的 `cordis.patch.yml`；
3. profile 自己的 `cordis.patch.yml`；
4. home 级 `cordis.patch.yml`；
5. `--patch` overlay。

patch 按 row id 定位并整体替换其 config，或插入新 row。查看本机实际启动树：`dsh --profile web --dump-config`。

- 内置 profile：`web`、`headless`、`sdk`、`sdk-minimal`、`acp`（以模板形式随包分发）。`web` 支持 live patch reload；其余在启动时一次性应用全部层。
- bundle 在自身 `package.json` 的 `dsh.bundle.patch` 声明补丁文件：`base`、`web-app`、`headless`、`sdk-app`、`acp-app`、`sdk-minimal`。
- `dsh-base` 是 web/headless/sdk/acp 的共享第一层（模型适配器、工具、持久化、沙箱与审批策略、settings、credentials、telemetry）。`dsh-sdk-minimal` 是刻意例外：不应用 base，自持完整显式 SDK 树。

## 应用启动唯一入口

只有 `dsh` profile 启动受支持 Node 应用；包 bin、demo、公开 SDK argv 逃逸均禁止（`scripts/verify-application-entrypoints.ts` 守门）。

调用链：`apps/cli/src/bin.ts` → `parseDshArgs()`（mode: `profile` | `plugin` | `dump-config`）→ `profile-boot.ts` 的 `runProfile({environment, profile, patchFiles, args})` → 由 `packages/boot/app-boot` 组装插件树。

## 核心 spine（`ctx` key）

| 包 | 拥有 | ctx key |
|---|---|---|
| `core/session` | append-only `SessionEvent` 日志与内存 store | `ctx.sessions` |
| `core/system-prompt` | prompt section + tool schema 组装 | `ctx.systemPrompt` |
| `core/tools` | 作用域工具注册表与受控执行流水线 | `ctx.tools` |
| `core/agent` | `Agent` 接口、live registry、`agent/*` 事件 | `ctx.agents` |
| `core/agent-loop` | 默认 driver 实现 | `ctx.agentLoop` |
| `core/scope` | per-agent 作用域注册原语 | library，无 key |
| `llm/llm` | 消息/流词汇表与 adapter 缝 | `ctx.llm` |
| `webhook/webhook` | 可信投递分发与 Workspace Session 创建 | `ctx.webhookRuntime` |

peer 依赖 spine 排名（`docs/module-graph.md`，共 782 条 peer 边）：session 90、llm 83、agent 64、tools 42、invariants 34、system-prompt 29、session-projection 29。

## Turn 流程（step = 一次模型请求 + 它调用的工具；turn = 0..n 个 step）

```text
turn/start → agent/pre-step (waterfall) → step/start → 追加 user/message
  → agent/request → llm/stream → assistant/chunk* → assistant/message
  → tool/call* → tools/pre-execute → tools/execute → tools/post-execute → tool/result*
  → step/end → agent/turn-stopping → turn/end
```

- 持久 session 事件：`turn/*`、`step/*`、`user/message`、`assistant/*`、`tool/*`；其余是 live 扩展点。
- waterfall：`agent/pre-step`、`agent/request`、`llm/stream`、`tools/{pre,post}-execute` —— listener 必须 `next()` 委派，否则短路链条。`agent/turn-stopping` 是串行、无 `next()`。

## 会话日志与投影

- 日志是模型上下文的唯一来源：`deriveMessages()` 从日志投影历史；raw `assistant/chunk` 保留 replay/UI 保真度；fork/resume/transcript/telemetry/persistence 都从这条流派生。
- 不变式 “Model-visible ⟺ logged”：任何进入模型请求的东西都必须能从日志重建；新的模型可见输入必须新增 session event。
- 关键符号位置：`packages/core/session/src/types.ts` 定义 `SessionEventMap`、`SessionEvent`、`SessionEventType`、`SESSION_FORMAT_VERSION`、`RequestHeaderReason`、`SurfaceOp` 等（Serena 已验证可定位）。
- `SessionEventMap` 成员默认 required-on-read：不认识该 event 类型的构建会拒绝加载日志，除非事件带 envelope 的 `ignorable: true`；只有结构性格式变化才 bump `SESSION_FORMAT_VERSION`。
- 投影缝：`dsh-session-projection` 拥有 `ctx.sessionProjections`；host 读者要么在激活时 require 该服务，要么显式失败。

## 能力缝（capability seam）

一个 seam = Service Definition（接口）+ Service Provider（实现）+ Consumer（通常是模型可见工具）三角色；单独一个角色不构成 seam，新增能力必须设计三者。缝的意义：换一个 provider 就能改变整个产品行为（如 fs/subprocess provider 指向远端沙箱会带走 Bash、PTY、LSP）。

## 新行为应该挂在哪

见 `docs/architecture.md` 的 “Where new behavior goes” 表：加模型 provider → `ctx.llm`；加模型可见能力 → `ctx.tools`；加人类命令 → `ctx.commands`；后台工作 → `ctx.jobs`；拦截请求/工具/turn → `agent/*` 或 `tools/*` 事件；加持久 session 状态 → 扩展 `SessionEventMap`。**插件优先，不改 loop**；改 `agent-loop` 必须同步更新 `docs/architecture.md`。

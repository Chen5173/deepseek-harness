# 包地图（packages/ 51 个 group）

权威来源：`packages/README.md` 的 group 表 + 每个 group 的 README（该 family 的权威包清单）。每个包只属于一个 group。

## 产品主线

| Group | 职责 |
|---|---|
| `core/` | 产品 API spine：session、system-prompt、tools、agent、agent-loop、scope、agent-default-model、agent-tool-presentation |
| `api/` | 远端 BFF 组装与 Typert RPC gateway（gateway、remotes、session-controller、settings-controller、workspace-controller）|
| `typert/` | 类型图生成、artifact 加载、运行时 registry |
| `llm/` | LLM 能力family：抽象 service + deepseek/pi-ai provider + retry + token-meter |
| `session/` | 持久会话数据面：persistence 缝与后端、projection 缝、log-backed titles |
| `session-query/` | 会话检索：logical corpus、有界读取、lineage、语义过滤、SQLite 全文检索 |
| `storage/` | 非会话存储枢纽 + 后端 + domain form |
| `workspace/` | Workspace 实体 |
| `interaction/` | 人类协作面：approval/interaction 缝、permission preset、commands、ask-user |
| `settings/`、`credentials/`、`identity/` | 用户设置缝+file provider；凭据引用/记录缝+env-over-`.env` provider；匿名身份 |

## 执行与工具能力

| Group | 职责 |
|---|---|
| `shell/` | bash 能力族：executor 缝、local/pwsh provider、模型可见工具 |
| `terminal/` | 持久 PTY 能力族（owner-scoped session + local impl + 工具）|
| `subprocess/` | subprocess 能力族 + 本地进程树 provider + 共享 Win32 库 |
| `code-runtime/` | 代码执行能力族 + worker-thread provider + PTC mode Consumer |
| `sandbox/` | 进程约束缝：bwrap/Landlock/Seatbelt 后端 |
| `fs/` | 文件系统能力族：缝、local impl、文件工具、检索工具 |
| `lsp/` | LSP 能力族：缝、通用 stdio provider、`lsp` 工具 |
| `web/` | Web 能力族：缝、search/fetch provider、模型可见 web 工具 |
| `skill/` | skill provider registry + local provider + catalog/loader 工具 |
| `attachment/` | 持久附件身份、校验、本地内容寻址存储 |
| `spill/` | Spill 能力族：存储缝、local impl、tool-result spill 策略 |

## 编排与运行时

| Group | 职责 |
|---|---|
| `subagent/` | 子代理能力族：provider-registry 契约 + 委派工具（in-process / claude-code / codex / dsh-sdk / acp）|
| `jobs/` | 通用后台 job 运行时 + 模型可见 job 控制工具 |
| `workflow/` | workflow 缝 + worker-thread 引擎 + `workflow`/`ralph` 工具 |
| `goal/` | 同 session 目标持久化与生命周期 |
| `schedule/`、`feedback/` | session 内定时跟进；人类反馈捕获与命令 |
| `compaction/` | 压缩能力族：Service Definition + basic provider + command Consumer |
| `context/` | 模型可见请求上下文：workspace instructions、time context、references |
| `guard/` | loop 卫生：重复调用提醒 + `tools/execute` deadline 强制 |
| `extensions/` | Agent 运行时自我修改：live plugin/service 检视 + 模型写挂载/卸载 |
| `hooks/` | Claude Code / Codex hook 桥 + 共享 wire-protocol 库 |
| `preset/` | 从 preset `cordis.yml` 组装 per-session agent 组合 |
| `plan/`、`todo/` | plan 协作状态（logged state）；`todo_write` 工具 |
| `webhook/` | 已校验外部事件、可信规则、fire-and-forget Workspace Session |
| `acp/` | 仅自动化的 Agent Client Protocol server |
| `sdk/` | 进程外 SDK：JSON-RPC 协议 + TS client/server |

## 装配与部署

| Group | 职责 |
|---|---|
| `bundle/` | 可安装的 `dsh --profile` patch 层（base、web-app、headless、sdk-app、acp-app、sdk-minimal）|
| `boot/` | 共享 app-bin 启动胶水（`app-boot`、`cmdline`）|
| `host/` | Web GUI host 半边：HTTP + SPA 服务器、workspace 目录选择实现、只读 plugin inventory 投影（7 个包）|
| `client/` | Web GUI 浏览器半边：shell 启动、browser-host RPC/事件、共享 client 服务、本地化、HMR、`ui-*` 功能插件（slot 系统组装 UI）|
| `experimental/` | 私有原型，不参与官方发布 |
| `util/` | 零依赖底层工具（`Branded<B>`、home/path helpers、timeout、retention 等）|
| `test-support/` | 测试基础设施（testkit、invariant、replay、Loader smoke）|
| `runtime-diagnostics/` | 运行时诊断：包自有 invariant 检查与报告 |

## 版本期望

多数 group 是产品（稳定 API）。例外：`e2b/` 是 POC，`experimental/` 未发布，`test-support/`、`runtime-diagnostics/`、`util/` 是 support，兼容性期望更低。

## 跨语言边界

- **TypeScript**：`apps/cli` + `packages/*`（Host 面与 Client 面两套 tsconfig face）。
- **Python**：`python/sdk`（客户端）通过 JSON-RPC 驱动 `dsh --profile sdk`；runtime wheel 把 `dsh` CLI 打包为 `deepseek-harness-sdk-runtime-<platform>-<arch>`；Python 只暴露 profile 选择 + 有序 patch 文件，不暴露完整 Cordis 树。
- **ACP**：`acp/` 提供仅自动化的 Agent Client Protocol server（`dsh --profile acp`）。
- **Native**：`native/landlock-run` 为 Linux 提供 `@deepseek-ai/node-addon-landlock-run`（沙箱后端）。
- **Web GUI 三件套**：浏览器（`packages/client` + `apps/web` 构建产物）↔ host（`packages/host` HTTP/SPA 服务器）↔ RPC gateway（`packages/api`）。注意：`apps/web` 的 Vite 入口只构建 shell，不是独立应用，只有 `dsh web` 注入 `window.__DSH_BOOT__`。

# 开发、测试与仓库约定（dsh）

## 常用命令（根 `package.json`）

```sh
pnpm install              # pnpm workspaces
pnpm run build            # tsc 产出 lib/types，tsdown 打包 runtime
pnpm run typecheck        # 先 build:lib:host
pnpm run lint             # oxlint（先 build:lib:host）
pnpm run test             # vitest run（单测）
pnpm run test:coverage    # CI 覆盖率门禁：packages/*/*/src 每文件 100%
pnpm run test:e2e         # 真实 API 测试，无 DEEPSEEK_API_KEY 自动跳过
pnpm run test:expected    # owner-local 进程期望
pnpm run test:snapshot    # 无 key 录制会话回放（-t <name> 过滤）
pnpm run doc-sync         # 全部文档 gate
pnpm run test:docs        # 快速文档检查（doc-quick）
pnpm run website:build    # VitePress 构建（兼作死链检查）
pnpm run duplication      # jscpd 跨文件克隆检测
pnpm run hygiene          # publint + workspace/包/依赖检查
pnpm dsh --profile headless "task"   # 从源码跑一个任务（需 key）
```

## 测试布局

- 测试与 src 同包：`packages/<group>/<pkg>/tests/*.spec.ts`（实测 814 个 `*.spec.ts`、`tests/` 下 959 个 `.ts`）。
- 根级 vitest 配置按面切分：`vitest.config.ts`（单测）、`vitest.e2e.config.ts`、`vitest.expected.config.ts`、`vitest.snapshot.config.ts`、`vitest.web.config.ts`、`vitest.web.perf.config.ts`、`vitest.web-stress.config.ts`。
- CI 覆盖率门禁是 `test:coverage` 而不是 `test`。
- 模型可见/用户可见的非平凡改动必须更新无 key 录制的会话快照（`snapshots/` 顶层树仅供 session-driven case）。

## 关键约定（写代码前必读 `AGENTS.md` 与 `packages/AGENTS.md`）

- 每个 npm 包名 `@deepseek-ai/dsh-<name>`；vendored 包重新 scope 且 `private: true`；`@deepseek-ai/cordis` 是每个 harness 包的 peerDependency（+dev）。
- 全 ESM；跨包用包名导入，包内相对导入带 `.ts` 后缀。
- **注册即 effect**：一切贡献走 `ctx.effect()` / `ctx.on()`；registry 的 `register()` 返回 disposer。
- waterfall listener 必须调用 `next()` 委派。
- 闭合 union 用 discriminant switch，末尾 `assertNever`；可合并扩展的 union 走有文档的 default。
- **Model-visible ⟺ logged**：新的模型可见输入必须新增 session event。
- **插件优先，不改 loop**；改 `agent-loop` 要更新 `docs/architecture.md`。
- 插件里禁止硬编码可调项：从 cordis.yml 传入经校验的 `Config`；`DEFAULT_*` 常量或测试钩子不算可配置。
- 误配置要 fail loud；跨边界不透明 id 用 `Branded<B>`。
- 信任同进程的类型化边界，不做多余运行时校验；只在 parser/config、queued、model/tool JSON、durable/file、worker、process、wire 边界校验。
- Source plane（tsconfig `paths` → `src`）与 artifact plane（`lib/`）不得混用。
- 每个模块/导出都要简洁 JSDoc；`verify-export-jsdoc` 强制函数类导出带 `@param`/`@returns`。
- 非平凡改动必须在同一 PR 里附 Agent Note（`.agents/notes/`）；归档 note 冻结，不得编辑。
- 文档双语（`*.md` / `.zh.md` + `.i18n.yaml`）；文件结尾恰好一个换行（pre-commit 校验）。
- Client UI 文案必须走 locale 字典（`verify-client-ui-i18n` 拒绝硬编码文案）。

## 相关文档入口

`AGENTS.md`（根约定）、`packages/AGENTS.md`（包约定）、`docs/development.md`（TS 项目布局）、`docs/testing.md`（测试策略）、`docs/defensive-patterns.md`（生命周期/并发/子进程/拆卸前必读）、`docs/AGENTS.md`（文档规则）、`docs/module-graph.md`（生成的依赖图）。

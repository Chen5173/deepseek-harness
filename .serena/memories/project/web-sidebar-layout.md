# Web 侧边栏（ui-sidebar）布局与 footer 槽契约

## 几何
- 折叠 rail 宽 `SIDEBAR_COLLAPSED = 56`（`packages/client/ui-layout/src/client/columns.ts`），展开 `SIDEBAR_MIN = 264`。
- rail 内边距 `padding: 18px 10px 6px`（`SidebarRoot.module.css .root.collapsed`）→ **内容盒宽 36px**，每个 rail 控件都是 36×36，纵向节奏 12px。
- 折叠是「滑动 + 交叉淡出」而非形变：内容按冻结的展开宽度淡出，`.collapsed` 布局只在 150ms 结束后生效（`COLLAPSE_SETTLE_MS`）。

## 槽（都在 `packages/client/ui-sidebar/src/client/contract/slots.ts` 声明）
| 槽 | kind | 占用者 |
|---|---|---|
| `sidebar.brand.mark` / `sidebar.brand.name` | single | ui-brand-official 等 |
| `sidebar.workspaces` | single | ui-workspace（浏览器 + 各插件 rail 图标） |
| `sidebar.settings` | single | ui-settings-general（齿轮） |
| `sidebar.footer.action` | **list** | 任意数量：dsh-chat-import（导入会话）、@linxin666/dsh-remote-web-ui（远程 + 更新）等 |

占用者只拿到 `{ wide }`，**按钮几何自负**（契约明说）；`wide=false` 即 56px rail。

## footer 叠放契约（2026-09-10 修复）
- 结构：`SidebarRoot.tsx` 的 `.footArea`（column）= `.footerActions` 在上、`.settingsArea` 在下。
- 展开态 `.footerActions { display: flex }`：占用者共享一行（宽 256px+ 时正常）。
- 折叠态 `.collapsed .footerActions`：**`flex-direction: column; align-items: center; width: auto; row-gap: 12px`**，一个图标一行、按 rail 的 12px 节奏。
- 修复前该规则缺 `flex-direction`（沿用了与 `.collapsed .settingsArea` 共享的 row 规则），多个占用者在 36px 内容盒里被挤成并排并溢出被裁剪。
- 测试：`packages/client/ui-sidebar/tests/sidebar-styles.client.spec.ts` 直接解析 `.module.css` 文本断言声明。该文件的 `declarations()` 助手**只取第一个匹配规则**（不合并 `@media` 内的覆盖），因此每个 selector 在该 CSS 里保持**单一规则**：给某 selector 加覆盖规则会让断言读到旧值。

## 第三方插件争用该容器的坑
- `dsh-chat-import` 的构建产物里保留了源码注释，实测记录：宿主 `footerActions` 是**不换行的 256px flex 行**，cordis 徽标（`flex:0 0 auto; width:256px`）、插件市场 launcher（`flex:none; width:calc(100% + 4px)`）不可收缩，nowrap 下会把同槽其它条目挤出容器、被侧边栏 `overflow:hidden` 裁剪或挤成竖排窄条。
- 插件曾用「把 footer 容器强制改成 column」自救（`@ychris12138/dsh-usage-stats`；chat-import CHANGELOG issue #25），并因此把自身按钮改成 `flex: 0 0 auto + width: 100%` 以兼容 row/column/wrap 三种容器。改动该容器前先看这些插件。

## 改完如何生效（本机）
- 启动方式：`node ./apps/cli/lib/bin.js web --no-open`（`dsh-start.ps1`），用本仓库构建产物。
- 只重建单个客户端插件：`npx pnpm --filter @deepseek-ai/dsh-client-ui-sidebar run bundle`（tsdown，产物 `lib/client.js`，CSS 由 lightningcss 内联成 `<style data-plugin-css>`，类名带 hash）。
- 宿主只在 **boot 时**组合 `window.__DSH_BOOT__` 图；bundle 内容的变更只通过 HMR 的 stat 轮询（`client-hmr` 行，web profile 恒挂载，500ms）走 `ClientModuleRegistry.rebuilt()` 进入图。bundle URL 带 `rev` 且响应头 `cache-control: immutable`。
- 路由：`/plugins/<row id>/client.js`（row id 不是包名，如 `ui-sidebar`）；只服务**已登记**的 path+search，其它一律 404；首页需要鉴权（本机实测 401）。

# dsh-plugin-session-delete

你是否困扰于 web 端无法删除对话？是否觉得归档对话键只是隐藏对话，删除得不够彻底？是否在尝试编辑 harness 时遇到对话话历史无法同步，而损坏的对话又无法删除？这个插件可以帮你！

**在 DeepSeek Harness 界面里安全地彻底删除会话。** 在会话顶部添加垃圾桶按钮，侧栏会话行 "..." 菜单内添加"删除会话"项，点击后出现风险确认弹窗（需勾选）；确认后会删除会话日志、投影缓存与工作区记账；运行中的会话会有提示，若仍选择删除会停止运行并删除。可在web中使用，并且理论上兼容一切web套壳的客户端。
**添加agent工具让agent可以删除会话。** 工具名`workbench_session_delete`

## 安装

```sh
dsh plugin --profile <profile> add file:C:/path/to/dsh-plugin-session-delete
```

重启 profile 生效。

## 功能

- 会话头部垃圾桶按钮
- 侧栏会话行 "..." 菜单注入"删除会话"项
- `RiskConfirmation` 风险确认：勾选"我已了解后果"后确认可用
- 删除链路：会话目录 + 投影缓存 + 工作区记账（经活动 storageDomain，内存/磁盘一致）
- `workbench_session_delete` 工具：agent 可直接删除会话

## 本 fork 的本地修改（相对上游 v0.3.1）

- **行菜单注入改为「克隆真实菜单项 + 插进 `.viewport`」**：上游把注入项 `appendChild` 到
  `[role=menu]` 容器末尾并自带一套内联样式。本 fork 的会话行菜单是 portal 渲染
  （`packages/client/ui-primitives/src/Menu.tsx`），菜单项实际位于 `.viewport` 滚动容器内，
  插到容器外会脱离滚动与 `max-height` 上限；自写样式也和外壳的 40px 单元格、hover 填充、
  标签省略号不一致。现在克隆最后一个真实菜单项作模板（class 与几何完全跟随外壳），
  只替换图标与文案。
- **红色走外壳令牌**：追加外壳自己的 `.danger` 类（`--dsw-alias-state-error-primary` 文字色 +
  danger hover 填充），与 ui-workspace 自己的「删除工作区」危险行同一套样式；危险类是
  CSS module 哈希名，因此从已加载样式表按「局部名 danger + 该令牌」扫描取得，不硬编码哈希，
  并保留一行内联色作为样式表尚未就绪时的兜底。
- **点击后先关菜单再弹确认框**：复用行内 ⋯ 触发器（它自带 `stopPropagation`），不切换当前会话。
- **标题读取更稳**：`innerText` 在无布局引擎的环境（jsdom 等）下是 `undefined`，
  改为 `innerText || textContent`；并剥掉侧栏「显示工作区」模式渲染的 `[工作区] ` 前缀，
  否则这类行永远匹配不到会话。
- **注入定位更稳**：可见性判据从 `offsetParent`（`position:fixed` 元素恒为 `null`，会误判）
  改为 `getClientRects()`；多个 `[role=menu]` 并存时取最后一个带菜单项的（新 portal 追加在后）。
- **新增无浏览器验证脚本**：`scripts/verify-menu-injection.mjs`，19 项断言，jsdom 按外壳真实
  DOM 形状搭桩（portal 菜单 / `.viewport` / `itemWrap > button.item > itemIcon + itemLabel` /
  分隔线 / 带 `menuOpen` 的会话行），覆盖注入位置、danger 类、红色兜底、幂等、点击派发、
  `[工作区]` 前缀剥离与「非会话行菜单不注入」。对任意 CSS module 命名形状都成立
  （前缀换成 `Menu_` 复跑同样 19/19）。

## 后续开发计划

- 添加更多针对会话的操作工具和选项
- 将已有的针对会话的选项做成工具提供给agent
- 
<img width="1800" height="1020" alt="image" src="https://github.com/user-attachments/assets/c66f6185-457d-4261-9e10-1b44b9959896" />

## 更新日志

- **v0.3.1（2026-08-14）**：修复删除会话后残留日志导致会话跑到「未分组」的问题。删除时同时清理原始 id 与 `session-` 前缀两种 id 形式；先删除磁盘日志并确认成功后再解除工作区记账，避免半删除会话脱离原分组；删除前先 flush 活动会话，防止 dispose 阶段回写/重建日志目录。
- **v0.3.0（2026-08-14）**：新增英文适配（i18n）。删除对话框、头部垃圾桶按钮与侧栏「删除会话」菜单项的全部文案接入客户端 zh/en 字典，跟随界面语言（设置中的语言或浏览器语言）自动切换并即时生效；未加载 locale 服务的环境会按浏览器语言回退到内置中英文字典。

---

# dsh-plugin-session-delete

Frustrated that sessions can't be deleted from the web client? Bothered by abandoned or mistyped conversations cluttering your sidebar? Ever tried editing your harness only to find the session history out of sync — with a corrupted session that just won't go away? This plugin has your back!

**Safely delete sessions from the DeepSeek Harness UI.** Adds a trash button at the top of the conversation and a "Delete session" item to the sidebar session-row "..." menu; clicking either opens a risk-consent dialog (checkbox required). On confirm, the session log, projection cache and workspace accounting are removed. Running sessions show a warning — if you still choose to delete, the session is stopped and then deleted. Works in the web, and is theoretically compatible with any web-shell-based client.
**Also adds an agent tool so agents can delete sessions.** Tool name: `workbench_session_delete`

## Installation

```sh
dsh plugin --profile <profile> add file:C:/path/to/dsh-plugin-session-delete
```

Restart the profile to apply.

## Features

- Trash button at the top of the conversation
- "Delete session" item injected into the sidebar session-row "..." menu
- `RiskConfirmation` risk-consent dialog: confirm is only enabled after ticking "I understand the consequences"
- Delete chain: session log + projection cache + workspace accounting (through the active storageDomain, so in-memory state and on-disk units stay consistent)
- `workbench_session_delete` tool: agents can delete sessions directly

## Roadmap

- Add more session-operation tools and options
- Expose the existing session options to agents as tools

## Changelog

- **v0.3.1 (2026-08-14)**: Fixed deleted sessions being left as "Ungrouped" rows after a partial delete. The host now cleans both raw UUID and `session-`-prefixed id forms, deletes the on-disk log and confirms it before removing workspace accounting (so a failed delete cannot detach a session from its group), and flushes a live session before detaching it to prevent dispose-time rewrites from recreating the log directory.
- **v0.3.0 (2026-08-14)**: Added English adaptation (i18n). All copy of the delete dialog, the header trash button and the sidebar "Delete session" menu item now lives in client zh/en dictionaries and follows the UI language (the language setting or the browser language), updating live on switch; environments without the locale service fall back to the built-in dictionaries by browser language.

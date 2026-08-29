# 插件问题整理（2026-08-28，供提 issue 用）

涉及 4 个包：2 个第三方插件（@linxin666 系）、1 个第三方插件（@huanlin）、1 个 DSH 核心（deepseek-ai/deepseek-harness）。

---

## 1. @linxin666/dsh-perf —— better-session-import 在 Windows 上路径拼错（盘符重复）

**现象**
启用 better-session-manager / 触发会话迁移时，host 报：

```
Error: Cannot find module 'C:\C:\Users\...\@linxin666\dsh-perf\lib\better-session-import.mjs' (MODULE_NOT_FOUND)
```

**复现方式**
- 环境：**Windows**（Linux/macOS 不受影响），profile 已安装 `@linxin666/dsh-perf`。
- 步骤：
  1. 在 dsh 的插件设置里启用/打开 dsh-perf 的「better session manager / 会话导入迁移」功能（`performEnable` → `runMigration`，把旧会话目录迁移进 SQLite 存储）；
  2. 观察 dsh host 进程的输出/日志。
- 预期：迁移子进程正常启动、迁移完成。
- 实际：host 日志出现 `Cannot find module 'C:\C:\Users\...\better-session-import.mjs'`（`MODULE_NOT_FOUND`），迁移失败、功能不可用。

**根因**
`lib/index.js` 的 `runMigration()` 用 `new URL("./better-session-import.mjs", import.meta.url)` 得到 file URL 后，**把 `moduleUrl.pathname` 直接当文件路径**传给子进程：

```js
const moduleUrl = new URL("./better-session-import.mjs", import.meta.url);
const child = spawn(process.execPath, [moduleUrl.pathname], ...);
```

Windows 下 file URL 的 `.pathname` 是 `/C:/Users/...`（带前导斜杠），Node 把它解析成 `C:\C:\Users\...`（当前盘根 + 绝对路径），于是模块找不到。POSIX（Linux/macOS）没有盘符，所以只影响 Windows。

**解决方案**
用 `fileURLToPath` 转回文件路径：

```js
import { fileURLToPath } from "node:url";
// ...
spawn(process.execPath, [fileURLToPath(moduleUrl)], ...);
```

**建议 issue 标题**
`better-session-import spawn fails on Windows: 'C:\C:\...' MODULE_NOT_FOUND (use fileURLToPath instead of URL.pathname)`

---

## 2. @linxin666/dsh-remote-web-ui —— 设置未就绪(loading)时侧栏入口（更新/远程）永久缺失

**现象**
侧栏底部「检查更新」「远程访问」两个入口按钮**同时消失**。与页面/插件缓存无关：settings 接口在页面加载时慢/失败（或任何使设置状态停在 loading 的情况），入口就不注册；只能靠重载客户端（如切换插件）碰运气恢复。

**复现方式**
- 环境：dsh web 页面（任意系统），装有 `@linxin666/dsh-remote-web-ui`。
- 步骤：
  1. 打开浏览器 DevTools（F12）→ Network 面板；
  2. 把 `settings.describe`（或 `api/settings*`）请求**拦截/失败**：DevTools → Network → 右键该请求 → `Block request URL`（或在 `Network conditions` 里限速到很慢）；
  3. 刷新页面（Ctrl+F5），看侧栏底部；
  4. 恢复网络后**再次刷新**，观察对比。
- 预期：侧栏底部始终显示「导入会话 / 检查更新 / 远程访问 / 设置」。
- 实际：设置请求被拦截期间刷新，**只剩「导入会话」「设置」**，「检查更新」「远程访问」不出现；恢复网络后不刷新则仍然缺失（状态停在 loading），再次刷新才恢复。

**根因**
`src/client/index.ts` 里 `enabled()` 对"非 ready"状态一律返回 false：

```ts
const enabled = (): boolean => {
  const snapshot = settingsScope.getSnapshot()
  return snapshot.status === 'ready'
    ? snapshot.value?.enabled ?? true
    : snapshot.status === 'unavailable'   // 'loading'（及其他状态）→ false
}
```

设置作用域初始状态是 `loading`；如果描述请求失败/超时，状态停在 `loading`，`enabled()` 恒为 false → 侧栏入口（sidebar.remote / sidebar.footer.action）不注册，且依赖 subscribe 恢复的路径不一定可靠（经 webUiSettings 兼容绑定）。

**解决方案**
非 ready 状态按"默认开启"处理（显式关闭只在设置就绪后生效）：

```ts
const enabled = (): boolean => {
  const snapshot = settingsScope.getSnapshot()
  return snapshot.status === 'ready' ? (snapshot.value?.enabled ?? true) : true
}
```

**建议 issue 标题**
`Sidebar entry (update + remote triggers) never registers when settings scope stays 'loading' — enabled() returns false for non-ready status`

---

## 3. @huanlin/dsh-plugin-session-delete —— 无标题会话无法从侧栏删除（"未能在会话列表中找到该会话"）

**现象**
对**没有持久标题**的会话（全新空白会话、或对话被清空后标题为空）点侧栏菜单「删除会话」，弹窗提示"未能在会话列表中找到该会话（可能已被删除或列表尚未刷新），请刷新后重试"，但会话其实还在列表里。

**复现方式**
- 环境：dsh web 页面，装有 `@huanlin/dsh-plugin-session-delete`（未打本地补丁的版本）。
- 步骤：
  1. 准备一个**没有持久标题**的会话：新建一个从未发送消息的空白会话（侧栏会显示目录名回退标题，如 `DSH-tmp`），或把某会话内容清空（如连续回退/rewind 到空，使标题投影为空）；
  2. 在侧栏该会话行上点击 `...` 菜单 → 「删除会话」；
  3. 观察弹窗。
- 预期：弹出删除确认对话框（标题 + sessionId），可继续删除。
- 实际：弹窗提示"未能在会话列表中找到该会话（可能已被删除或列表尚未刷新），请刷新后重试"，确认按钮不可用，无法删除。对比：**有标题**的会话（侧栏显示真实标题）可以正常删除。

**根因**
侧栏删除入口**只拿标题、没有会话 id**（DOM 只带标题文本）。解析时：
- 客户端 `resolveTargetFromStore()` 只匹配 `s.title`，无标题会话的 `title` 为 null → 跳过；
- 兜底的 host 列表 `/__chameleon/session/list` 对无标题会话返回 `title: null` → 匹配失败 → 判定 notFound。

而侧栏实际显示的是 `displayTitle`（无标题时回退为 cwd 目录名），两边对不上。

**解决方案**
- 客户端按 `displayTitle`（含 cwd 目录名回退）匹配，而不是只认 `title`；
- host 列表接口对无标题会话回退返回 cwd 目录名作标题（`title ?? basename(cwd)`）。

**建议 issue 标题**
`Delete-from-sidebar fails for sessions without a durable title (blank / rewound-to-empty): resolve by displayTitle / cwd fallback`

---

## 4. DSH 核心（deepseek-ai/deepseek-harness）—— 侧栏收起(rail)时 footer 操作按钮不是一列

**现象**
侧栏收起成 36px rail 后，多个 `sidebar.footer.action` 入口（导入会话、检查更新、远程访问）**横排**在 rail 里：容器被撑到 72px 宽并居中，最左按钮被裁掉一半、右侧按钮与其并排，形成错位的两列。

**复现方式**
- 环境：dsh web 页面，装有 ≥2 个 `sidebar.footer.action` 入口的插件（如 `dsh-chat-import` 的「导入会话」+ `@linxin666/dsh-remote-web-ui` 的「检查更新/远程访问」）。
- 步骤：
  1. 正常（wide）模式下确认底部有「导入会话 / 检查更新 / 远程访问 / 设置」；
  2. 点击侧栏「收起侧边栏」按钮，进入 36px rail 模式；
  3. 看底部按钮区。
- 预期：底部操作按钮**纵向一列**（每个 36px 图标，居中对齐），从上到下：导入会话、检查更新、远程访问、设置。
- 实际：按钮**横排**错位——「导入会话」与「远程访问」并排（一个被裁掉一半、一个溢出），「检查更新」挤到另一行，形成混乱的两列/多行布局。

**根因**
`packages/client/ui-sidebar/src/client/SidebarRoot.module.css`：

```css
.collapsed .footerActions {
  display: flex;
  justify-content: center;
  width: auto;
  /* 缺：flex-direction: column —— 收起态仍横排 */
}
```

收起态没有把 footer 操作区切成纵向，多个 36px 图标按钮并排，超出 36px rail 被裁剪。插件（chat-import / remote-web-ui）在 rail 态都按"单列 36px 图标"设计，属于 dsh 侧栏的布局缺失。

**解决方案**
```css
.collapsed .footerActions {
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
```

**建议 issue 标题**
`Collapsed (rail) sidebar: sidebar.footer.action entries stay in a horizontal row and overflow the rail — should stack as one column`

---

## 附：本次为这些修复改动的文件（你的本地副本，提 issue 时可引用）

- `~/.dsh/profiles/web/node_modules/@linxin666/dsh-perf/lib/index.js`（修复 #1）
- `~/.dsh/profiles/web/node_modules/@linxin666/dsh-remote-web-ui/lib/client.js` + `src/client/index.ts`（修复 #2）
- `my-custom/vendor-plugins/dsh-plugin-session-delete/src/client.js` + `src/index.js`（修复 #3）
- `packages/client/ui-sidebar/src/client/SidebarRoot.module.css`（修复 #4）

> 注：上述插件均为 npm 安装，作者发新版/修复后，更新会覆盖本地补丁；建议按上面 issue 反馈，或保留本地 patch 脚本。

---

## 5. dsh-chat-import —— wide 模式下「导入会话」独占整行，把同排入口挤出侧栏被裁

**现象**
侧栏展开（wide）时，底部「检查更新」「远程访问」两个按钮**在 DOM 里但在屏幕上不可见**（被裁掉）：280px 宽的侧栏里，「导入会话」占满 256px，「检查更新」被裁一半、「远程访问」完全在侧栏外（overflow:hidden 裁剪）。收起（rail）模式不受影响。

**复现方式**
- 环境：dsh web 页面，装有 `dsh-chat-import` + `@linxin666/dsh-remote-web-ui`（即 `sidebar.footer.action` 里有 ≥2 个入口）。
- 步骤：
  1. 展开侧栏（wide 模式），看底部；
  2. F12 → Elements，选中「导入会话」按钮，查看其计算样式：`width: 100%`、`flex: 0 0 auto`；「检查更新」「远程访问」的 getBoundingClientRect 超出侧栏右边界（侧栏 `overflow: hidden`）。
- 预期：三个入口并排、都在侧栏内可见。
- 实际：「导入会话」独占整行宽度，另两个按钮被推到侧栏外裁掉，只剩「导入会话」+「设置」可见。

**根因**
`lib/client.js` 的 `ImportButton` 行内（非浮动）模式下：

```js
...baseStyle, flex: "0 0 auto",
width: rail ? "36px" : "100%",   // wide 态独占整行
```

wide 态 `width:100%` 让导入按钮占满 footer 行，同槽其它入口（远程/更新）被挤出 280px 侧栏并被 overflow 裁剪。它自带的"整行占用者"检测只识别 cordis 徽标/插件市场 launcher，不识别同槽的其它插件入口。

**解决方案**
wide 态改为与兄弟共享一行（仅本按钮时 flex:1 效果等同 100%）：

```js
flex: rail ? "0 0 auto" : "1 1 auto",
width: rail ? "36px" : "auto",
minWidth: rail ? undefined : 0,
```

**建议 issue 标题**
`ImportButton takes width:100% and pushes sibling sidebar.footer.action entries out of the sidebar (clipped by overflow) — share the row with flex:1 in wide mode`

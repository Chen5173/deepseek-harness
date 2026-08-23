# my-custom 目录说明

本目录存放个人对 DeepSeek Harness 的本地定制与辅助脚本，**不随官方仓库提交**（目录整体保持未跟踪，属个人工作区内容）。

## 提交规范（个人 fork 规则）

- **提交信息一律用中文**（以后都如此），**详细说明（body）也要翻译成中文并完整保留**，不要只留一行标题。
- 提交信息**首行**写版本号，格式：`【个人定制版本号】: cv.<major>.<minor>.<patch>`，空一行后再写中文标题。
  - 版本号 = `git rev-list --count HEAD ^<my-custom/oh-my-dsh-base.txt 中的基线>`，映射为 `cv.1.0.<count-1>`：定制系列压缩成一次提交后为 `cv.1.0.0`，此后每 commit 一次 patch +1（`cv.1.0.1`、`cv.1.0.2` …；与 Web / CLI 的 `cv.1.0.x` 版本号一致，见定制 5）。
  - 示例：

    ```
    【个人定制版本号】: cv.1.0.1

    Feat: 会话行三点菜单「打开工作区目录」
    ```

## 定制 1：允许 `dsh web --host 0.0.0.0`

### 目的

官方代码刻意拒绝绑定所有网络接口：

```text
error: --host 0.0.0.0 is intentionally not supported yet for safety:
it would expose remote code execution to the network; use 127.0.0.1 instead
```

本分支在源码层面移除该 CLI 拒绝逻辑，使 `--host 0.0.0.0` 可以正常绑定。

### 修改点

- `packages/bundle/web-app/src/startup.ts`：删除对 `--host 0.0.0.0` 的 `program.error(...)` 检查；`--host` 原样透传给 webserver 配置，schema 本身只接受 `127.0.0.1 | 0.0.0.0`。
- `packages/bundle/web-app/tests/startup.spec.ts`：把「拒绝全接口 host」的用例改为「正确发布 `host: 0.0.0.0`」。
- `apps/cli/tests/built-bin.e2e.ts`：移除旧的「`--host 0.0.0.0` 以 usage error 退出」断言。

官方文档（README / Agent Notes 等）**未做任何改动**，方便后续与上游合并。

### 使用方式

源码方式（推荐，改动即时生效）：

```sh
pnpm dsh web --host 0.0.0.0 --no-open
pnpm dsh web --host 0.0.0.0 --no-open --port 8080
```

已构建/安装的 `dsh` 二进制需要先重新构建：

```sh
pnpm run build
dsh web --host 0.0.0.0 --no-open
```

启动后 URL 行形如：

```text
dsh web: http://127.0.0.1:3080 (LAN: http://<本机LAN IP>:3080)
```

- 本机浏览器仍打开 `127.0.0.1` 地址；`LAN` 地址用于局域网内其他机器访问。
- 需要额外的具名 authority 时继续使用 `--trusted-host <host[:port]>`。

### 安全提醒

绑定 `0.0.0.0` 会把完整 Host API（其中包含可执行 bash 的 `session.prompt`）暴露到网络；Web 运行时会自动把本机 LAN IP 字面量纳入 `/api` 浏览器信任围栏，因此**同一网络内能构造 Host 头的客户端都可能触达完整 API**。

- 仅在可信网络中使用；
- 不要把这个改动提交到官方分支；
- 若要恢复官方行为，回退上面的三个文件即可：

```sh
git checkout HEAD -- packages/bundle/web-app/src/startup.ts \
  packages/bundle/web-app/tests/startup.spec.ts \
  apps/cli/tests/built-bin.e2e.ts
```


## 定制 2：非回环访问的 token 口令校验

### 目的

绑定 `0.0.0.0` 后，任何能触达端口的客户端都可能调用完整 Host API。本定制给 `dsh-host-webserver` 增加一个**默认关闭**的 `authToken` 网关：来自非回环 socket 的请求必须通过口令校验；本地 `127.0.0.1` 访问完全不受影响。

### 认证方式

- **浏览器**：远程首次访问会被重定向到自包含的 `/login` 表单，输入正确 token 后写入 `HttpOnly; SameSite=Strict` 的 `dsh_web_auth` 会话 cookie（关闭浏览器后失效），后续页面、`/api` 请求和 WebSocket 自动携带。
- **脚本 / 自动化**：带 `Authorization: Bearer <token>` 请求头即可。
- **回环 socket 一律免检**（包括经 SSH 隧道到达的 `127.0.0.1`）。判定用的是 socket 远端地址，不是可伪造的 Host 头。

### 使用方式

```sh
pnpm dsh web --host 0.0.0.0 --no-open --auth-token '替换成足够长的随机串'
# 或者用环境变量，避免口令进入 shell 历史：
DSH_WEB_AUTH_TOKEN='替换成足够长的随机串' pnpm dsh web --host 0.0.0.0 --no-open
```

远程浏览器访问打印出的 `LAN: http://<本机LAN IP>:<port>` 地址，登录页输入 token 后即可使用。已构建/安装的 `dsh` 二进制同样需要先 `pnpm run build`。

token 规则：长度 8–512，只允许 `A-Za-z0-9._~-`；建议用 `openssl rand -hex 32` 生成。`--auth-token` 会出现在进程列表中，敏感环境优先使用 `DSH_WEB_AUTH_TOKEN` 环境变量。

### 修改点

- `packages/host/webserver/src/auth-gate.ts`（新增）：token 网关纯函数、登录表单、cookie/Bearer 校验、常量时间比较。
- `packages/host/webserver/src/index.ts`：`authToken` 配置项 + HTTP/upgrade 分发前执行网关。
- `packages/bundle/web-app/src/startup.ts`：新增 `--auth-token` flag 并透传。
- `packages/bundle/web-app/cordis.patch.yml`：webserver 行接入 `ctx.webStartup.authToken ?? process.env.DSH_WEB_AUTH_TOKEN`。
- `packages/host/webserver/tests/auth-gate.spec.ts`（新增）：网关行为单测。

### 安全边界

- 纯 HTTP 下 token 与 cookie 都是明文传输；防窃听请再套 HTTPS 反向代理或 SSH 隧道。
- 登录接口不做限流，token 必须足够随机。
- settings/credentials 等特权接口仍钉死为仅回环，正确 token 也不解锁（有意为之）。

### 回退

```sh
git checkout HEAD -- packages/host/webserver/src/auth-gate.ts \
  packages/host/webserver/src/index.ts \
  packages/host/webserver/tests/auth-gate.spec.ts \
  packages/bundle/web-app/src/startup.ts \
  packages/bundle/web-app/cordis.patch.yml \
  packages/bundle/web-app/tests/startup.spec.ts \
  apps/cli/tests/built-bin.e2e.ts
```


## 定制 3：修复手机端 `crypto.randomUUID is not a function`

### 现象

手机通过 `http://<LAN IP>:<port>` 访问时：看不到会话列表、新建工作区报 `crypto randomUUID is not a function`。原因：HTTP 非 secure context 下浏览器没有 `crypto.randomUUID()`，而客户端每次 `/api` RPC 调用都会用它生成 `rpcId`，于是所有请求在发出前就抛错。

### 修改点

- `packages/host/apiproxy/src/fetch/random-uuid.ts`（新增）：优先用 `crypto.randomUUID()`，不可用时回退到 `crypto.getRandomValues()` 组装 RFC 4122 v4 UUID。
- `packages/host/apiproxy/src/fetch/client.ts`：`mintRpcId()` 改走上面的 helper。
- `packages/client/ui-conversation/src/client/random-uuid.ts`（新增）：同样的 helper，用于图片附件的草稿 id。
- `packages/client/ui-conversation/src/client/service.ts`：图片附件 id 不再直接调用 `crypto.randomUUID()`。
- 新增 `packages/host/apiproxy/tests/random-uuid.spec.ts` 回归测试（模拟 insecure origin）。

### 回退

```sh
git checkout HEAD -- packages/host/apiproxy/src/fetch/client.ts \
  packages/host/apiproxy/tests/random-uuid.spec.ts \
  packages/client/ui-conversation/src/client/service.ts
rm packages/host/apiproxy/src/fetch/random-uuid.ts \
  packages/host/apiproxy/tests/random-uuid.spec.ts \
  packages/client/ui-conversation/src/client/random-uuid.ts
```


## 其他文件
- `dsh.bat` / `DSH-WEB.bat`：本地 Windows 启动脚本。
- `assets/`、`png2ico.py`：桌面图标素材与生成脚本。

## 定制 4：会话列表四件套（标题落盘 / 排序刷新 / 自动命名 / 时间分组）

### 目的

解决侧栏会话管理的四个痛点：

1. **重启丢标题**：LLM 标题晚于 turn/end 生成，投影缓存 checkpoint 赶不上，冷启动列表回退显示工作区名。
2. **最近更新不自动刷新**：updatedAt 只算人类输入，agent 干活不计入；列表要切走再切回才重排。
3. **标题像首条输入**：默认命名只看首条 prompt 且上限 5 词/10 字。
4. **无时间分组**：历史会话平铺难找。

### 修改点（按提交粒度）

**#3 标题落盘与显示**（c3d2d6ccd2）
- packages/session/session-title/src/index.ts：每次 session/title append（rename / fallback / provider）后立即触发投影缓存 checkpoint（fail-soft）。
- packages/host/apiproxy/src/api-proxy.ts：session.list 行新增 title / titleFallback 字段；缓存缺 title 时做一次有界冷读（coldTitleProbeMaxBytes，默认 2 MiB，每次宿主运行每会话一次）从日志尾恢复标题与首条输入截断。
- packages/client/runtime/src/client/sessions/{service,lineage,manager}.ts：显示链 title → 首条输入截断 → 工作区名 → id。

**#1 排序自动刷新**（65e737f461）
- sessionListMetadata 投影单元新增 lastActivityAt（人类输入 + assistant 步消息 + turn 完成，取 max），stateVersion 升到 2；updatedAt 排序改用它。
- 客户端 mux 帧：assistant/message / turn/end 也推进列表 updatedAt（max 守卫），侧栏实时重排。

**#4 自动命名升级 + 行菜单重新生成**（c7b72240de）
- packages/session/session-title-llm：新增 includeFirstReply 选项——把首个含文本的 assistant 回复与首条输入一起 frame 给命名模型（有界等待 firstReplyWaitMs，默认 30s）。
- packages/session/session-title-first-prompt-llm：新增 includeFirstReply（默认关）/ firstReplyWaitMs 配置。
- packages/bundle/base/cordis.patch.yml：标题目标 5 词/10 字 → **12 词/24 字**，maxInputBytes 4096 → 8192，显式开启 includeFirstReply: true。
- 新 RPC session.refreshTitle（host 走 ctx.sessionTitle.refresh）；会话行菜单新增「重新生成标题」，失败 toast 提示、原标题不动。

**后续升级：标题改为「会话内容总结」**（不再只看首条输入 + 首个回复）
- packages/session/session-title-llm：新增 includeAssistantReplies——把整段对话（用户提示 + assistant 回复，按日志顺序）组装成 JSON conversation 交给命名模型总结；超出 maxInputBytes 时从中间裁剪（保留开头上下文 + 最近消息）。
- packages/session/session-title-all-prompts-llm：默认开启 includeAssistantReplies（真正的会话总结提供器）。
- packages/bundle/base/cordis.patch.yml：标题提供器换成 session-title-all-prompts-llm，maxInputBytes 8192 → 32768。
- 效果：自动命名与「重新生成标题」都会基于整段对话内容生成标题，而非首句。

**#2 时间分组**（Feat: group the session sidebar by calendar time buckets）
- packages/client/ui-workspace：新增「分组方式：按时间」——今天 / 昨天 / 前 7 天 / 前 30 天 / 更早（自然日口径），组内按最近更新排序，组头可折叠，今天与昨天默认展开。
- 时间模式下「排序方式」菜单隐藏（跨时间桶的手动排序无意义）。
- 时间分组视图可显示所属工作区：视图选项新增「显示工作区」勾选，行标题按 `[工作区] 标题` 渲染（未分组会话显示 `[Ungrouped]`）。
- 时间桶**最近活动窗口**修正：最近 1 小时内活动过的会话即使跨午夜（如 23:59 刚更新、现在 00:00）也归入「今天」，与行尾“刚刚/几分钟前”标签保持一致（修复前会掉进「昨天」，造成“标签显示刚刚、却在昨天”的矛盾）。

### 验证

- 定向测试：session-title* / apiproxy / client-connection / client-runtime / ui-workspace 全绿（1038 + 131 用例）；host/client 双面 tsc -b 通过；pre-commit 门禁通过。
- 改动全在本 fork 源码（UI 列表无插件注入点，插件需整体重画列表，故未走插件路线）；官方文档未动。

### 回退

```sh
git revert --no-commit c3d2d6ccd2 65e737f461 c7b72240de <时间分组提交>
git commit -m "revert: sidebar session-management customizations"
```

## 定制 5：品牌名 + 自增版本号（Oh-My-Dsh <release> cv.<major>.<minor>.<patch>）

### 目的

Web 左上角 / 浏览器标签页 / HTML 标题原本显示官方占位名 `DSH Local Build`。本定制把它改为个人 fork 品牌 `Oh-My-Dsh <release> cv.<major>.<minor>.<patch>`（与 `dsh -V` 完全同格式），版本号 = 自上游基线提交以来本分支的 commit 数映射为 `cv.1.0.<count-1>`：定制系列**压缩成一次提交后为 `cv.1.0.0`**，此后每 commit 一次 patch +1（`cv.1.0.1`、`cv.1.0.2` …），天然记录“我的修改”的进度。

### 展示效果

- 左上角品牌名（侧栏，展开态）：`Oh-My-Dsh 0.1.1-rc.2 cv.1.0.0 <7位commit>`（commit 徽标保留）。
- 浏览器标签页 / HTML `<title>`：`Oh-My-Dsh 0.1.1-rc.2 cv.1.0.0`。
- CLI：`dsh -V` / `--version` 输出 `Oh-My-Dsh 0.1.1-rc.2 cv.1.0.0`（与 Web 完全一致）。
- 版本号 = 自基线提交以来本分支的 commit 数，映射为 `cv.1.0.<count-1>`；基线是定制系列起点 `b150a551b8`。

### 修改点

- `scripts/oh-my-dsh-version.ts`（新增）：计算 build 版本（`git rev-list --count HEAD ^<base>` 得 count，映射为 `1.0.<count-1>`；支持 `DSH_OH_MY_DSH_BUILD` 显式覆盖，值形如 `1.0.0`），并拼出 `Oh-My-Dsh <release> cv.<build>`（release 读仓库根 package.json）。
- `my-custom/oh-my-dsh-base.txt`（新增）：存上游基线提交 hash（定制系列的起点）。基线变更时改这一个文件即可。
- `scripts/build.ts`：`pnpm run build` 时若未显式设置 `DSH_CLIENT_TITLE`，自动注入 `ohMyDshClientTitle()` 的结果；显式 `DSH_CLIENT_TITLE` 或官方 `--profile official`（`DeepSeek Harness`）仍优先。
- `packages/client/ui-sidebar/src/client/SidebarRoot.tsx`：品牌回退文案改为读 `process.env.DSH_CLIENT_TITLE ?? 'DSH Local Build'`，个人构建时显示新品牌，无注入环境（测试 / 官方）仍显示旧占位名。
- `apps/cli/src/bin.ts`：`readVersion()` 检测到 `my-custom/oh-my-dsh-base.txt`（fork 标记）时输出 `Oh-My-Dsh <release> cv.<build>`；无标记的官方/安装构建仍输出纯 release 版本。仓库根相对 artifact 解析，任意 cwd 下结果一致。

### 使用方式

```sh
pnpm run build   # 构建后 dsh web 与 dsh -V 均显示 Oh-My-Dsh <release> cv.1.0.0
# 注意：单独跑 `pnpm run build:lib` 不会注入 DSH_CLIENT_TITLE，会把 Web 品牌回退成 DSH Local Build；
# 改客户端代码后请用完整 `pnpm run build` 重构建以保留品牌。
# 手动指定版本号（跳过 git 计数）：
DSH_OH_MY_DSH_BUILD=1.0.0 pnpm run build
# 手动指定完整标题（完全覆盖）：
DSH_CLIENT_TITLE='Oh-My-Dsh 0.1.1-rc.2 cv.1.0.0' pnpm run build
```

> CLI 的 `-V` 在**运行时**实时取 git 计数（无需每次重新构建）；Web 品牌是**构建时**注入（需 `pnpm run build`）。两者共用同一个 `my-custom/oh-my-dsh-base.txt` 基线。

### 回退

```sh
git checkout HEAD -- scripts/build.ts packages/client/ui-sidebar/src/client/SidebarRoot.tsx apps/cli/src/bin.ts
rm scripts/oh-my-dsh-version.ts my-custom/oh-my-dsh-base.txt
```

## 定制 6：对话输入框模型名旁显示供应商

### 目的

同一个模型（如 DeepSeek）可能由多个供应商提供，但对话输入框右下角的模型触发器只显示模型名，看不出当前走的是哪家。本定制在模型名旁显示供应商标签，官方 DeepSeek 路由（`deepseek-official`）显示 `official`，其它供应商显示其目录分组名。

### 展示效果

- 官方 DeepSeek：`official.DeepSeek-V4-Flash`（供应商.模型名，无 effort 时）。
- 第三方供应商（如 Volcengine ARK）：`Volcengine ARK.DeepSeek-V4-Pro`。
- 触发器 aria-label 同步带上供应商（`…，供应商 {provider}，推理等级 {effort}`），悬停 title 同样包含。
- 模型不在目录中（移除/未广告）时不显示供应商；未选择模型时无供应商。

### 修改点

- `packages/client/ui-model-selection/src/client/ModelSelect.tsx`：触发器按当前选中行的 group 计算 `providerLabel`（`deepseek-official` → `official`，否则用分组名），按 `供应商.模型名` 顺序渲染（供应商为弱化色前缀）；title / aria 一并带上。
- `packages/client/ui-model-selection/src/client/locales.ts`：新增 `provider.official`；`trigger.aria` / `trigger.ariaEffort` 模板增加 `{provider}`。
- `packages/client/ui-model-selection/src/client/ModelSelect.module.css`：新增 `.triggerProvider`（与 effort 同色调）。
- 测试：`model-select.client.spec.tsx` 新增官方/第三方供应商显示用例并更新 aria 断言；`declared-reasoning.e2e.ts`、`replay-round-trip.e2e.ts` 及 40 个 web aria golden 同步更新（e2e 需 Playwright 浏览器，本机未装，golden 按 ariaSnapshot 语义手工同步）。

### 回退

```sh
git checkout HEAD -- packages/client/ui-model-selection/src/client/ModelSelect.tsx packages/client/ui-model-selection/src/client/locales.ts packages/client/ui-model-selection/src/client/ModelSelect.module.css packages/client/ui-model-selection/tests/model-select.client.spec.tsx
git checkout HEAD -- apps/web/tests/declared-reasoning.e2e.ts apps/web/tests/replay-round-trip.e2e.ts apps/web/tests/snapshots
```

## 定制 7：会话行三点菜单「打开工作区目录」+ 目录用资源管理器打开

### 目的

侧栏会话行右侧「···」菜单增加「打开工作区目录」，一键用系统资源管理器打开该会话的工作区目录。

### 实现

- 客户端 packages/client/ui-workspace：SessionNode 带 cwd；行菜单顶部新增「打开工作区目录」（带 IconFolderOpen16，仅当会话有 cwd 时显示）；通过注入的 openPath 调 Host 打开；失败弹淡出 toast。
- 宿主 packages/host/apiproxy/src/native-path-opener.ts：Windows 上 openPath 打开**目录**时改为 powershell Start-Process explorer.exe 直接调起资源管理器（绕过 shell 默认关联），文件仍走 Invoke-Item 默认应用。这样目录不会再被默认关联/浏览器接管、报 is-a-directory。

### 生效前提：必须重启 dsh web 服务

宿主 openPath 代码在**服务启动时**加载；重建 lib 后运行中的服务仍是旧代码（会出现“在浏览器打开 + is a directory”）。需要重启：

my-custom\dsh.bat web --host 127.0.0.1 --no-open

### 规避 dsh-better-sidebar 的 openPath 拦截

第三方插件 `dsh-better-sidebar` 会把 `ctx.workspaces.openPath` 整体 wrap 劫持：所有经过它的打开操作都被送进它自己的**侧栏编辑器**（目录开不出、报 is-a-directory）。因此侧栏「打开工作区目录」**不走 `ctx.workspaces.openPath`**，而是直接在 ui-workspace 里调底层 `connection.api.host.openPath`（原始 RPC），绕过该拦截直达宿主资源管理器。该改动用例：Chat 侧的文件打开仍可由插件接管（设计如此），此处只管会话行菜单的“打开目录”。

### 回退

git checkout HEAD -- packages/client/ui-workspace packages/host/apiproxy/src/native-path-opener.ts

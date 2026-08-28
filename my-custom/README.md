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
- 标题提供器选择与预算参数**已移出源码**（定制 9 第 1 步）：`packages/bundle/base/cordis.patch.yml` 回到上游取值（first-prompt-llm / 5 词 / 10 字 / 4096 / 64），改由 `my-custom/plugins/dsh-oh-my-dsh-config/cordis.patch.yml` 承载「停用 base 行 + 插入 all-prompts 行」。**未安装该插件时标题回到上游行为**。
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

## 定制 8：Docker 一键部署（公网隧道 + 授权码）

### 目的

像自建 SiYuan 容器那样，把本仓库的 **dsh Web 界面**一键部署到 Docker，并通过 Cloudflare 公网隧道对外提供访问，启动时打印授权码（远程访问需在登录页输入）。

### 新增文件（全部位于 my-custom/，另在仓库根新增 .dockerignore）

- `my-custom/Dockerfile`：多阶段构建镜像。构建阶段在 node:22-slim 里 pnpm install + `pnpm run build`（`DSH_CLIENT_COMMIT_HASH=0000000`、`DSH_OH_MY_DSH_BUILD=1.0.0` 跳过 git 依赖），并把 `my-custom/plugins-web`（web 插件种子 profile）在 Linux 环境里 `pnpm install` 成 `/app/dsh-seed`（原生依赖按 Linux 编译）；运行阶段跑 `node apps/cli/lib/bin.js web --host 0.0.0.0 --port 3080 --no-open`。
- `my-custom/docker-entrypoint.sh`：容器入口。先检查 `/data/profiles/web` 是否已有插件种子哈希，缺失或过期时把镜像里的 `/app/dsh-seed/profiles/web`（含 Linux 版 node_modules）整体灌入 `/data/profiles/web`（保留已有的 cordis.patch.yml / cordis.yml）；有 `DSH_TRUSTED_HOST` 环境变量时追加 `--trusted-host`，让 /api 信任公网 Host（浏览器信任围栏必需）。
- `my-custom/docker-compose.yml`：`dsh-web`（本仓库 Web，映射 `127.0.0.1:3080`，数据卷 `./dsh-data:/data`）+ `cloudflared`（cloudflare/cloudflared 公网隧道，指向 `http://dsh-web:3080`）。容器名 `oh-my-dsh-web` / `oh-my-dsh-tunnel`。
- `my-custom/start.sh` / `start-docker.bat`（Windows 快捷入口）：一键启动。
- `my-custom/stop.sh` / `stop-docker.bat`：停止。
- `my-custom/.gitignore`：忽略运行时生成的 `.env` / `.dsh-auth` / `.dsh-tunnel-url` / `dsh-data/`。
- 仓库根 `.dockerignore`：构建上下文过滤（排除 node_modules/.git/lib/dist/本地状态与授权码），并保证 Dockerfile 本身仍在上下文中；对 `my-custom/plugins-web` / `my-custom/vendor-plugins` 加豁免（`!my-custom/vendor-plugins/**`），让 vendored 插件的 `lib/` 等目录进入构建上下文。
- `my-custom/plugins-web/`：web profile 种子 manifest（`package.json` 的 `dsh.profile.bundles` + `dependencies`、`pnpm-workspace.yaml`、`.npmrc`、`pnpm-lock.yaml`），与宿主机 `~/.dsh/profiles/web` 的插件清单对应，构建时在 Linux 里安装。
- `my-custom/vendor-plugins/`：本地/私有插件的源码副本（当前：`dsh-billing-balance`、`dsh-plugin-session-delete`、`dsh-at-file`、`dsh-notification`、`dsh-session-manager`）。Docker 构建网络访问不了 github.com，也拿不到 `D:\` 本地路径，所以这些插件以 `file:` 依赖 vendoring 进镜像。

### 使用方式

```sh
bash my-custom/start.sh        # Windows 可直接双击 my-custom/start-docker.bat
```

首次运行会：生成访问授权码（存 `my-custom/.dsh-auth`，之后复用）→ 构建镜像 → 启动公网隧道 → 启动 Web，最后打印：

```text
▶ 用 docker-compose 启动 ...
▶ 启动公网隧道 ...

📎 本机: http://127.0.0.1:3080
📎 公网: https://xxxxx.trycloudflare.com
🔑 访问授权码: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx （也存于 my-custom/.dsh-auth）
```

- **本机访问** `http://127.0.0.1:3080`：回环免授权，直接可用。
- **公网访问** 打印的 trycloudflare 地址：非回环请求走 auth-token 网关，首次访问会跳转 /login，输入打印的授权码即可（HttpOnly cookie 保持会话）。
- 隧道已运行时再次执行会显示 `⏭ 公网隧道已在运行` 并复用同一公网地址。
- 数据（会话/工作区）持久化在 `my-custom/dsh-data/`，授权码在 `my-custom/.dsh-auth`；`stop.sh` 停止后数据保留。

### 注意事项

- 镜像构建需要联网（pnpm registry + Docker Hub 拉 base 与 cloudflared 镜像），首次构建较慢（全量 pnpm install + build + 插件种子安装）。
- 首次启动容器时 entrypoint 会把镜像里的插件种子灌入 `my-custom/dsh-data/profiles/web`（含数百 MB node_modules），之后启动不再重复；数据卷里已有的 `cordis.patch.yml` / `cordis.yml` 不会被覆盖。

### 插件清单（构建时打进镜像）

Docker 里的 web profile 是**构建时**生成的：`my-custom/plugins-web` 在镜像构建阶段（Linux 环境）`pnpm install`，原生依赖按 Linux 编译后进入镜像；容器首次启动由 entrypoint 灌入 `dsh-data/profiles/web`，之后除非种子哈希变化不再覆盖。插件清单维护在 `my-custom/plugins-web/package.json`：

- **增/删插件**：编辑 `my-custom/plugins-web/package.json` 的 `dependencies` 与 `dsh.profile.bundles`，重建镜像并重启容器（`my-custom/start-docker.bat`）。重建后种子哈希变化，entrypoint 会自动把新 node_modules 灌入数据卷。
- **插件来源**：
  - 已发布到 npm 的插件直接写 `"name": "semver"`（如 `dsh-chat-import`、`dsh-context`），走 npmmirror。
  - `github:` 源插件（如 `dsh-at-file`、`dsh-notification`、`dsh-session-manager`、`@huanlin/dsh-plugin-session-delete`）：Docker 构建网络连不上 github.com，改为复制一份源码到 `my-custom/vendor-plugins/<名>/`，依赖写 `"file:../vendor-plugins/<名>"`。
  - 本地目录插件（如 `dsh-billing-balance`）：同样复制到 `my-custom/vendor-plugins/` 走 `file:`。
- 数据卷里的 web profile 的 `package.json` 保留 `file:../vendor-plugins/...` 字样，但 node_modules 已含全部插件，运行期不需要 vendor 目录；不要在容器里再跑 `pnpm install`。
- 公网地址每次隧道重启都会更换（trycloudflare 免费快速隧道特性）；若需固定域名，可改用自有 Cloudflare Tunnel 凭据，把 compose 里 cloudflared 的 command 换成 `tunnel run <tunnel-name>`。
- `--host 0.0.0.0` 与 auth-token 网关依赖定制 1 / 定制 2，勿在官方分支使用。
- Docker 未安装/未启动时脚本会明确报错退出。

### 公网免配对（远程设备不再提示“此设备未配对”)

容器里的 remote-web-ui 插件默认要求非回环访问先配对设备（扫码），公网设备因此会卡在“此设备未配对”。本部署已通过 `dsh-data/settings.yaml` 关闭：

```yaml
remote-web-ui:
  requirePairingForLan: false    # 非回环 /api 免配对直通（公网域名已被 --trusted-host 信任 + 授权码网关保护）
  publicBaseUrl: https://<当前隧道域名>  # /api/pair/* 路由信任的公网来源
  autoTunnel: false              # 必须关：容器隧道由 cloudflared 管，开着会忽略 publicBaseUrl
```

- `publicBaseUrl` 由 `start.sh`（调用 `my-custom/update-web-ui-settings.cjs`）每次启动时按当前隧道 URL 自动刷新；隧道换地址后容器会随 `.env` 变化重建生效。
- 想恢复扫码配对时，把 `requirePairingForLan` 改回 `true` 并重启容器即可。

### 模型配置同步（宿主机 → Docker）

模型配置页（settings / credentials / llm）在 dsh 里**强制只允许回环访问**（`dsh-client-connection` 把整个配置域钉死在 loopback，`--trusted-host` 与授权码都不能放开，没有开关）。所以公网隧道访问时看不到模型提供方目录，属于设计行为。

配模型用 `my-custom/sync-config.sh`（或双击 `sync-config.bat`），把宿主机 `~/.dsh` 的配置同步进容器数据卷并重启：

- **`settings.yaml`** → 模型提供方（`llm-pi-ai.providers.*`）+ 默认模型（`agent-default-model`）
- **`.credentials.yaml`** → API key refs（`DEEPSEEK_API_KEY` / `ARK_API_KEY` / …），`apiKeyEnv` 就是通过凭证服务从这份文件解析的
- 复制后自动重新应用容器专属 `remote-web-ui`（免配对 + 当前公网 URL），并重启 web 容器
- Windows 下复制出来的文件是 777，脚本会用一次性容器把 `.credentials.yaml` 修正为 0600（credentials 提供方强制 owner-only），entrypoint 启动时也会自愈

宿主机家目录可用 `DSH_DOT_DSH` 覆盖（默认 `~/.dsh`）。`codemaker` 这类走 `127.0.0.1` 的宿主机本地代理提供方在容器里不通，只有公网端点（如 ARK）可用。

> 说明：把配置**打包进镜像**也可以做，但 API key 会固化进镜像、配置变更要重建镜像，且构建上下文拿不到 `~/.dsh`——不如同步脚本灵活，故不采用。

## 定制 9：把定制提取成插件（进行中，第 1 步已落地）

### 目的

降低本 fork 与上游的 rebase 成本：能落到 profile 层的东西不再改 `packages/` 源码。

### 已提取（第 1 步）

见 `my-custom/plugins/dsh-oh-my-dsh-config/README.md`。零源码改动，承载两项：

1. **定制 4(c) 的配置部分**：会话标题提供器换成「整段对话总结」实现包及其预算参数，
   移到插件的 `cordis.patch.yml` 层（做法是「停用 base 行 + 插入新行」，
   因为补丁行改 `name` 会被整条跳过）。
2. **定制 5 的标签页标题部分**：经 `webserver/index-inject` 注入运行时脚本改写产品标题，
   不再需要为改品牌重跑 `pnpm run build`。

### 源码回退状态（重复的部分不再双份承载）

| 项 | 源码现状 |
|---|---|
| `packages/bundle/base/cordis.patch.yml` 的 `session-title-llm` 行 | **已回到上游**（first-prompt-llm / 5 词 / 10 字 / 4096 / 64），与上游零差异；标题定制改由插件层单独承载，验证见 `node my-custom/plugins/dsh-oh-my-dsh-config/scripts/verify.mjs`（含「仅一个标题提供器在跑」断言） |
| `packages/bundle/base/package.json` 的 `@deepseek-ai/dsh-session-title-all-prompts-llm` 依赖行 | **保留**：workspace 解析需要它，删掉插件插入的那行就装不上；1 行成本，rebase 冲突面几乎为零 |
| `scripts/build.ts` / `scripts/oh-my-dsh-version.ts` 的构建期品牌 | **保留**：不是与插件重复——侧栏多行品牌块读 `DSH_CLIENT_BRAND/_RELEASE/_BUILD`，`dsh -V` 在插件挂载之前；插件只改写标签页后缀 |
| `apps/cli/composition.md`（生成物） | 回退后重新与 base 取值一致（此前源码是 all-prompts、生成文档写 first-prompt，属漂移） |

### 明确不提取（附原因）

| 定制 | 原因 |
|---|---|
| 1 放开 `--host 0.0.0.0` 的守卫删除 | CLI/startup 层，插件不可达；且与定制 2 安全耦合，只提取危险的半边是负收益 |
| 2 token 鉴权网关 | webserver 只有 exact/prefix/fallback 三张表，**没有请求分发前的过滤器注册口** |
| 3 `crypto.randomUUID` 兜底 | 属内核 bug 修复（`fetch/client.ts` 的 mintRpcId），该走上游而非插件 |
| 4(b) `lastActivityAt` 排序语义 | 改了 `sessionListMetadata` 投影单元与客户端 mux 帧推进，属投影语义 |
| 7 会话行菜单项 | ui-workspace 的会话行菜单是硬编码，无行级 slot；新增的「删除会话」项走插件侧 DOM 注入（见定制 10），源码里的既有项（重新生成标题 / 打开工作区目录）仍属定制 4 |
| 8 `session/rewind` | 新必需事件类型 + surface fold + RPC 表，三条插件硬墙全中 |
| 9 `--no-plugins/--plugins-only` | CLI 与 profile 编排层，发生在任何插件挂载之前 |

### 第 2 步候选（未开工）

侧栏品牌块与时间分组列表：技术上是「priority 遮蔽 single 槽」，代价是承接整张列表的上游演进，
且与已装的 `dsh-better-sidebar` / `dsh-session-manager` 抢同一块 single 槽——开工前需要先定槽位仲裁。

## 定制 10：会话行 ⋯ 菜单的「删除会话」（插件侧，零源码改动）

### 目的

会话行的三点菜单末尾多一项红色「删除会话」，点击弹风险确认框，确认后彻底删除
（会话日志 + 投影缓存 + 工作区记账），不切换当前会话。

### 承载

`my-custom/vendor-plugins/dsh-plugin-session-delete`（@huanlin v0.3.1 的本地 fork）。
行菜单在 ui-workspace 里是硬编码 + portal 渲染，无行级 slot，所以只能 DOM 注入；
本次把注入实现改成**克隆真实菜单项**并插进 `.viewport` 末尾，红色复用外壳的 `.danger`
（`--dsw-alias-state-error-primary`）。细节与逐条原因见该目录 README 的「本 fork 的本地修改」。

删除链路本身不走 RPC——宿主没有 `session.delete`；插件在 host 半边注册
`POST /__chameleon/session/delete`，并额外暴露 `workbench_session_delete` 工具给 agent。

### 生效前提（重要）

该插件**当前未装进任何 profile**（`~/.dsh/profiles/*/package.json` 里没有它），所以页面上看不到。
启用：

~~~sh
dsh plugin --profile web add file:C:/Nt/dsh/my-custom/vendor-plugins/dsh-plugin-session-delete
~~~

然后重启 `dsh web`（宿主半边需要重启加载，重启会断开当前 GUI 会话）。

### 验证

~~~sh
node my-custom/vendor-plugins/dsh-plugin-session-delete/scripts/verify-menu-injection.mjs
~~~

19 项断言，jsdom 按外壳真实 DOM 形状搭桩，覆盖注入位置（`.viewport` 末尾）、danger 类、
红色兜底、幂等、点击派发与 `[工作区]` 前缀剥离、非会话行菜单不注入。不启动服务、不写仓库状态。

页面级判据：侧栏任一会话行点 ⋯ → 菜单最底部出现红色「删除会话」（带垃圾桶图标、上方一条分隔线）
→ 点击后菜单关闭并弹出确认框，勾选「我已了解后果」才能确认。

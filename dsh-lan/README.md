# dsh-lan —— 让 DSH Web GUI 从局域网用 ip:端口 访问

一句话：**GUI 继续只监听回环，本机另起一个局域网侧监听转发过去**，DSH 自己的 token 认证原样保留。
Windows 与 macOS 共用同一个转发器实现，只有启动脚本不同。

## 目录内容

| 文件 | 作用 |
|---|---|
| `scripts/lan-bridge.mjs` | **转发器本体**（唯一的功能实现）。默认纯转发；`--rewrite-host` 时改写 Host/Origin |
| `dsh-lan.sh` | **macOS / Linux / WSL / Git Bash 入口**：起 GUI（自动带 `--trusted-host`）+ 起转发器 |
| `dsh-lan.ps1` | **Windows 入口**：调用仓库自带的 `dsh-start.ps1`（附加 `--trusted-host`）+ 起转发器；`-GuiOnly` / `-BridgeOnly` 选模式 |
| `dsh-lan.cmd` | **cmd.exe / 双击入口**：把参数原样透传给 `dsh-lan.ps1` |
| `dsh-lan.repo` | 自动生成的备忘文件：记住 DSH 仓库路径（可安全删除） |
| `scripts/ws-client.mjs` | 诊断：对某个地址做一次 WebSocket 握手（101/401 = 正常，426 = 升级头被剥） |
| `scripts/ws-upstream.mjs` | 验证用的 mock 上游，平时用不到 |

## 为什么需要转发器（背景）

1. `dsh web --host 0.0.0.0` 被上游**故意拒绝**——注释写得很直白：那会把本机 RCE 暴露到网络；
2. `webserver` 行的 `host` 类型只接受 `127.0.0.1 | 0.0.0.0`，直接绑局域网 IP 不合法；
3. `/api` 前面有一道 **Host/Origin 信任栅栏**（防 DNS rebinding 与跨站请求），它只接受回环或你显式声明的 authority；栅栏之后还有**独立的 token 认证**（HttpOnly cookie，loopback 没有特权通道）。

所以受支持的形态是：GUI 仍绑回环 + 转发器在局域网侧监听 + `--trusted-host <本机局域网IP>` 让栅栏接受这个 authority。

## 快速开始

### Windows

三个后缀，同一个名字、同一套子命令：`dsh-lan.ps1`（Windows）、`dsh-lan.cmd`（cmd.exe / 双击）、`dsh-lan.sh`（macOS / Linux）。

```powershell
# 一个窗口搞定：起 GUI（内部调用 D:\dsh\dsh-start.ps1，附加 --trusted-host）+ 转发器
.\dsh-lan.ps1

# cmd.exe 或双击同样可以（参数透传给 ps1）
.\dsh-lan.cmd
```

常用参数：

```powershell
.\dsh-lan.ps1 -AutoLogin -Allow 10.228.0.0/16   # 手机打开裸地址即可，无需 token
.\dsh-lan.ps1 -LanPort 3092 -Port 8080          # 局域网端口 / GUI 端口
.\dsh-lan.ps1 -GuiOnly                          # 只起 GUI
.\dsh-lan.ps1 -BridgeOnly -RewriteHost          # 只起转发（GUI 已在跑、且没带 --trusted-host）
.\dsh-lan.ps1 -BridgeOnly -Token "<token 或 URL>" -AutoLogin -Allow 10.228.0.0/16
.\dsh-lan.ps1 -PrintOnly                        # 只打印将执行的命令
.\dsh-lan.ps1 -Repository D:\dsh -LanIp 10.224.50.116
```

> 端口约定：**3081 = GUI（只绑回环）**，**3082 = 转发器（绑本机局域网 IP）**，两个进程一眼分得开。
> 想换端口：`-LanPort <N>`（PowerShell）/ `--lan-port <N>`（shell），GUI 端口仍是 `-Port` / `--port`。

### macOS / Linux

```bash
chmod +x dsh-lan.sh          # 只需要一次

./dsh-lan.sh                 # 起 GUI（自动 --trusted-host）+ 纯转发，Ctrl+C 一起退出
./dsh-lan.sh --dry-run       # 只打印将执行的命令
./dsh-lan.sh --no-gui        # GUI 已在别处跑时，只起转发器
./dsh-lan.sh --port 8080 --allow 192.168.1.23
./dsh-lan.sh -- --help       # “--” 之后的参数原样透传给 dsh CLI
./dsh-lan.sh --auto-login --allow 10.228.0.0/16    # 手机打开裸地址即可，无需 token
```

仓库位置的解析顺序：`-Repository` / `--repo` → 环境变量 `DSH_REPO` → 上次记住的 `dsh-lan.repo`
（只在它真的指向一个含 `apps/cli/lib/bin.js` 的目录时才用）→ `DSH_HOME` 的父目录 → 从脚本位置向上查找。
解析成功后会写回 `dsh-lan.repo`，所以仓库不在脚本附近时，`-Repository D:\dsh` 只需给一次。

## 什么时候用哪个模式

| 你的情况 | 用哪条 |
|---|---|
| 还没有 GUI | `dsh-lan.cmd`（不加参数）：用 `--trusted-host` 起 GUI，再起转发器，Ctrl+C 一起停 |
| **已经启动了 DSH** | 直接 `dsh-lan.cmd` 就行：它探测到 3081 已有 GUI 就**不再起第二个**，只起转发器；并会告诉你还差什么（未信任时提示加 `-RewriteHost`，没 token 时提示 `-Token`/`-TokenFile`） |
| **已经有一个 GUI 在跑**（比如你自己用 `dsh-start.ps1` 起的） | `dsh-lan.cmd -BridgeOnly -RewriteHost`；也可以直接双击本目录下的 `启动转发器.lnk` |
| GUI 是 `dsh-lan.*` 起的（已信任局域网 authority） | `dsh-lan.cmd -BridgeOnly`（不必改写 Host，闸门保持完整） |
| 想开机自动起 | 给 `dsh-lan.cmd`（或 `启动转发器.lnk`）建快捷方式，丢进 `shell:startup` |
| 只想看命令不执行 | `-PrintOnly` / `--dry-run` |

`dsh-lan.cmd` 的不加参数模式会**再起一个 GUI**：若 3081 已被别的 GUI 占用，第二个会启动失败，
这时脚本会打印警告并提示改用 `-BridgeOnly`（GUI 退出后端口等待也不会误判，因为会检查进程是否还活着）。

> `启动转发器.lnk`（双击即可）用的是一个不带引号的绝对路径，所以**别把 dsh-lan 目录搬走后继续用它**；
> 它在新窗口里跑，日志留在窗口里，Ctrl+C 停止。

## 与仓库启动脚本的关系

`dsh-lan.ps1` 不重复实现启动逻辑，它**调用仓库自带的 `dsh-start.ps1`**，只多加一个参数：

```
& "D:\dsh\dsh-start.ps1" web --no-open --port 3081 --trusted-host 10.224.50.116
```

`dsh-lan.sh` 同理**调用 `dsh-start.sh`**（找不到才退化为直接调 `node apps/cli/lib/bin.js`）。
因此 `DSH_HOME=仓库/.dsh_home`、首次运行把 `~/.dsh/sessions` 链接进来、参数透传这些行为，全部由仓库脚本负责，两边不会漂移。

## 两个平台的功能对照

能力集合一致：两边是同一套子命令（`-BridgeOnly`/`--bridge-only`、`-GuiOnly`/`--gui-only`、
`-RewriteHost`/`--rewrite-host`、`-Token`/`--token`），Windows 额外给一个 `dsh-lan.cmd` 方便 cmd.exe 和双击。

| 能力 | Windows | macOS / Linux |
|---|---|---|
| 起 GUI（自动 `--trusted-host`）+ 转发，Ctrl+C 一起退 | `dsh-lan.ps1`（或 `dsh-lan.cmd`） | `dsh-lan.sh` |
| GUI 端口（只绑回环，默认 3081） | `-Port` | `--port` |
| 局域网端口（默认 3082） | `-LanPort` | `--lan-port` |
| 自动登录（手机免 token） | `-AutoLogin` | `--auto-login` |
| 来源白名单（单个 IP 或 CIDR） | `-Allow` | `--allow` |
| 显式放开所有来源 | `-AnySource` | `--any-source` |
| 只起转发 / 改写 Host | `-BridgeOnly` / `-RewriteHost` | `--bridge-only` / `--rewrite-host` |
| 直接给 token 或 token 文件 | `-Token` / `-TokenFile` | `--token` / `--token-file` |
| 只起 GUI | `-GuiOnly` | `--gui-only` |
| 只打印命令 | `-PrintOnly` | `--dry-run` |
| 看帮助 | `-h` / `-Help`（`/?`、`help` 也行） | `-h` / `--help`（`help` 也行） |
| 透传 dsh 参数 | 直接跑 `dsh-start.ps1` | `dsh-lan.sh -- <参数>` |
| 仓库定位 | `-Repository` / `$env:DSH_REPO` / 自动向上查找 | `--repo` / `$DSH_REPO` / 自动向上查找 |
| GUI 输出接管 + token 学习 | 由 ps1 重定向到临时日志，转发器 `--token-file --echo-log` 读取 | 同左 |

两边都把 GUI 的 stdout 落到日志再由转发器读取、都由转发器打印带 token 的 LAN URL、
都有 `--auto-login` 的来源护栏，脚本本身都不生成或伪造凭据。

## 认证：第一次要带 token

GUI 启动时会打印一行：

```
dsh web: http://127.0.0.1:3081/?token=xxxxxxxx...
```

在局域网设备上打开 `http://<本机IP>:3082/?token=xxxxxxxx...` —— 服务端会用这个 token 换一个绑定“当时那个 authority”的 HttpOnly cookie，之后就可以直接访问 `http://<本机IP>:3082/`。
token 只在启动进程的那个终端打印过，**不会**再生成第二个。

## 手机端不用输 token（自动登录）

token 只存在于 GUI 进程的输出里，所以**脚本层必须自己拿到那段输出**。两个启动脚本都是这么做的：

1. 把 GUI 的 stdout 落到一个临时日志文件（转发器再用 `--echo-log` 把它回显出来，输出不会丢）；
   **前提**：`gui | …` 回显只在**本脚本自己起 GUI** 时存在（它接管了 GUI 的 stdout）。
   GUI 若由你自己在终端里启动、或你用 `-BridgeOnly` 只起转发器，那段输出在那个终端里，
   转发器读不到，也就不会回显；此时 token 只在你自己的窗口里。想看回显：用默认模式跑一次，
   或 `-TokenFile <你把 GUI 输出重定向到的文件>`。没有 `--token-file` 时转发器会明说回显是关的。
   （`dsh web:` 那行有时被前一条进度输出粘住，转发器会在 `dsh web:` 处断行并丢掉控制字符，
   保证它单独一行；拿到 token 后还会打印一条干净的 `lan-bridge: LAN URL = …`。）
2. 用 `--token-file <日志>` 启动转发器，转发器从日志里认出 `?token=...`，
   自己打印一条**已经带 token 的完整局域网 URL**：
   ```
   lan-bridge: LAN URL = http://10.224.50.116:3082/?token=xxxxx
   ```
   在手机浏览器里打开这条 URL 一次，cookie 就下来了（默认 30 天），之后直接开裸地址。
3. 加 `--auto-login`（PowerShell 是 `-AutoLogin`）后，连那一次都不用：
   转发器看到「未认证的**页面导航**」被 GUI 回 401 时，自己用 303 把浏览器送到 `/?token=...`，
   于是浏览器**自己**完成了 DSH 的 token 交换。XHR / fetch / WebSocket 的 401 不会被改写。

```bash
# macOS
./dsh-lan.sh --auto-login --allow 10.228.0.0/16
```

```powershell
# Windows
.\dsh-lan.ps1 -AutoLogin -Allow 10.228.0.0/16
```

**为什么必须写 `--allow`**：自动登录等于「谁连得上，谁就拿到一个会话」。转发器因此拒绝在没有
来源限定时空跑 —— 要么 `--allow <ip[,ip|cidr]>`（支持单个 IP 或 CIDR），要么显式 `--any-source`
表示你接受这一点。`--any-source` 启动时会打印一行醒目警告。手机 IP 会漂，写网段更省事，
例如 `--allow 10.228.0.0/16`。

已经自己起过 GUI（不需要重启）时，也可以只做这两件事：把 GUI 的输出重定向到文件，然后

```bash
node scripts/lan-bridge.mjs --lan-port 3082 --token-file <那个文件> \
     --auto-login --allow 10.228.0.0/16 --echo-log
```

`-BridgeOnly` / `--bridge-only` 场景同理：把 `--token-file` 指过去即可，或者直接 `--token <token>` ——
`--token` 也接受一整条带 `?token=...` 的 URL（会自己把 token 抠出来）。
（注意在 shell / PowerShell 里要把带空格的内容整体加引号，否则参数会被拆开。）

## 两种模式的区别

区别只在“谁让 DSH 信任局域网这个 Host”：

| | 纯转发（默认） | 改写 Host（`--rewrite-host`） |
|---|---|---|
| GUI 是否需要 `--trusted-host` | 需要 | 不需要（不用重启 GUI） |
| `/api` 的 Host 栅栏 | 保留（真实 Host 被显式信任） | 被绕过（服务端只看到 127.0.0.1） |
| token 认证 | 需要 | 需要 |
| 适用 | 长期使用（配合 dsh-lan.*） | GUI 已在跑、不想重启时 |

改写模式只改写**同源**的 `Origin`，外部 Origin 原样透传，所以跨站那半防护仍然生效。

## 排错

一行判断栅栏有没有被信任（403 = 未信任；401 = 已信任，只差认证）：

```powershell
curl.exe -s -o NUL -w "%{http_code}" -H "Host: 10.224.50.116:3082" http://127.0.0.1:3081/api
```

判断 WebSocket 升级链路（101/401 = 正常；426 = 升级头被中间层剥掉）：

```powershell
node scripts/ws-client.mjs 10.224.50.116:3082
```

| 现象 | 原因 |
|---|---|
| 页面能打开，操作全失败 | `/api` 被栅栏 403（Host 未被信任）→ 用 `--trusted-host` 或 `--rewrite-host` |
| 打开就是 authentication required | 没带 `?token=...`，或换了 authority（token 换来的 cookie 绑定 host:port） |
| 一直“自动重连” | WebSocket 没升级成功（握手头被剥）→ 见上面的 `scripts/ws-client.mjs` |
| 转发器没打印带 token 的 LAN URL | 它没在 @@日志文件@@ 里找到 token：确认 GUI 输出确实落到了 @@--token-file@@ 指向的文件（GUI 从终端启动时输出在终端里，不在文件里） |
| @@--auto-login@@ 不生效 | 来源没落在 @@--allow@@ 里，或那次请求不是页面导航（XHR 的 401 不会被改写）；先刷新一次页面 |
| 手机上看不到会话记录 | 不是转发问题：会话列表按工作区分组渲染，**分组展开状态存在浏览器 localStorage**（`dsh.workspace.view.v5`，按 origin 隔离）。新设备上所有分组默认收起 → 点开工作区分组即可，或把分组切成“一个列表” |

## 已经在代码里处理掉的坑

1. **WebSocket 升级头不能当 hop-by-hop 删**。`Connection: Upgrade` / `Upgrade: websocket` / `Sec-WebSocket-*` 是握手的载荷，删掉后网关回 `426 Upgrade Required`，前端就一直重连。升级路径因此单独走 `rewriteUpgradeHeaders()`，只改 authority。
2. **PowerShell 5.1 会把参数里的双引号吃掉**，`node -e "..."` 那种一行式会收到被破坏的代码 → 所以探测本机 IP 改成 `node scripts/lan-bridge.mjs --print-lan-ip`（无引号参数）。
3. **PowerShell 5.1 读无 BOM 的 UTF-8 会按 GBK 解码**，所以 `dsh-lan.ps1` 与 `dsh-lan.cmd` 是**纯 ASCII**（改文件时不要顺手加中文；要加就存成带 BOM 的 UTF-8）。`dsh-lan.sh` 的中文注释没问题——Unix shell 按字节处理。
4. **macOS 自带 bash 是 3.2**，脚本只用 3.2 支持的写法（没有 `local -n`、`mapfile` 之类）。

## 安全说明

- 默认转发器绑在**本机局域网 IP** 上（不是 `0.0.0.0`）；要放开用 `--listen 0.0.0.0:3082`。
- 认证没有被削弱：任何来源都需要 GUI 那条 32 字节随机 token 换来的 cookie，没有它一律 401。
- 用 `--rewrite-host` 时，`/api` 的 DNS-rebinding 那半防护对局域网方向失效（这正是推荐配合 `--trusted-host` 的原因）；来源可用 `--allow` 收窄。
- 转发的只是 HTTP/WebSocket，不会把 shell、文件系统或凭据暴露到网络——但 GUI 本身能驱动 agent，所以仍等于把本机能力开放给你信任的网络。

# dsh-oh-my-dsh-config

Oh-My-Dsh 个人定制的第 1 步提取件：**零内核源码改动**，把两项定制从 fork 的 packages/ diff 里搬出来。

| 内容 | 承载方式 | 对应原定制 |
|---|---|---|
| 会话标题提供器（整段对话总结）与其预算参数 | 纯配置：本插件 cordis.patch.yml 层 | 定制 4(c) 的配置部分 |
| 浏览器标签页品牌标题 | 宿主半边：经 webserver/index-inject 注入「全局变量 + 页内脚本」两行 | 定制 5 的标题部分 |

## 目录

- package.json：dsh.bundle.patch 声明；无构建步骤（纯 ESM，src/ 直发）
- dsh.plugin.json：fork 侧插件清单
- cordis.patch.yml：① 停用 base 标题行 + 插入 all-prompts 行；② 挂载本插件
- src/index.js：宿主半边，计算品牌事实并注册首页注入
- src/title-fix.js：页内脚本源码（单独成文件，便于阅读与语法校验）
- scripts/verify.mjs：18 项断言，覆盖 patch 组合语义 + 注入行 + 生产渲染 + 假 DOM 行为
- scripts/verify-cordis-emit.mjs：真实 cordis 上下文里的事件收发放验

## 安装

~~~sh
dsh plugin --profile web add C:/Nt/dsh/my-custom/plugins/dsh-oh-my-dsh-config
# 然后重启 dsh web：宿主插件需要重启加载，重启会断开当前 GUI 会话
~~~

## 四条机制约束（都从代码里读出并实测，不是推测）

1. **换提供器实现包不能靠改 name。** applyEntryPatches 在补丁行的 name 与目标行现有
   name 不一致时 warn 并**整条跳过**（packages/boot/app-boot/lib/index.js:96）。所以正确做法是
   「停用原行 + 插入新行」；本层即如此，且在官方 base（first-prompt）与本 fork 曾经的 base
   （all-prompts）两种取值下都成立——base 行现已回退为上游取值，见下节。
2. **config 是整行替换，不是字段合并。** 见 packages/bundle/base/cordis.patch.yml 头部注释；
   新行必须写完整 config。
3. **reasoningEffort: off 必须是字符串。** js-yaml 4 走 YAML 1.2 核心方案，off 保留为字符串
   "off"（已实测），正好匹配 session-title-llm 的 z.string() schema；写成 true/false 才会出错。
4. **标题只做后缀改写。** DocumentTitle 在选中会话时写「会话标题 — 产品标题」，其中只有产品标题
   部分属于本插件。因此脚本只匹配 replaces 里的已知产品标题（官方占位名 DSH Local Build 与 fork
   构建期已注入的同串），未知产品标题一律不动，并用 MutationObserver 跟踪 React 之后的写入。

## 验证

~~~sh
node my-custom/plugins/dsh-oh-my-dsh-config/scripts/verify.mjs
node my-custom/plugins/dsh-oh-my-dsh-config/scripts/verify-cordis-emit.mjs
~~~

两条脚本都不依赖 cwd、不启动服务、不写仓库状态。verify.mjs 走的是**生产解析路径**
（appBoot.loadOverlayPatches + composeEntries）与**生产渲染器**（renderIndexInjections），
所以「补丁行是否真被组合出来」不是靠人工比对 YAML 得出的。

页面级判据（安装并重启后）：标签页显示 Oh-My-Dsh <release> cv.<build>；点开任一有标题的会话后
变成「<会话标题> — Oh-My-Dsh <release> cv.<build>」；**无需**重跑 pnpm run build。

## 源码侧已回退：本插件是唯一承载

`packages/bundle/base/cordis.patch.yml` 的 `session-title-llm` 行已改回上游取值
（first-prompt-llm / targetWords 5 / targetCjkCharacters 10 / maxInputBytes 4096 / maxOutputTokens 64），
该文件与上游**零差异**。也就是说：

- 装了本插件 → 生效的是本层插入的 all-prompts 行（12 词 / 24 字 / 32768 / reasoningEffort off），
  与回退前的最终配置逐字段相同；verify.mjs 的「base 标题行被停用」「仅一个标题提供器在跑」两条断言
  就是在钉这件事。
- 删了本插件（或换到未装它的 profile）→ 标题回到上游行为，**不会**残留半套定制。
- 唯一仍留在源码里的是 `packages/bundle/base/package.json` 的 1 行 workspace 依赖声明（见下节）。

## 尚未搬出源码的部分（以及原因）

- dsh -V 的品牌输出：apps/cli/src/bin.ts 在任何插件挂载之前，属 CLI 层，插件不可达。
- 侧栏多行品牌块：sidebar.brand.name 可以 shadow，但 .logoRow 高度属外壳几何。本插件已把品牌
  三要素写进 globalThis.__DSH_OHMY_BRAND__，第 2 步的侧栏组件可直接读，不必再依赖构建期
  DSH_CLIENT_BRAND/_RELEASE/_BUILD。
- packages/bundle/base/package.json 里对 @deepseek-ai/dsh-session-title-all-prompts-llm 的 1 行
  依赖声明：workspace 解析需要它，保留成本极低。若要彻底移出源码，得把该依赖加进 profile 的
  package.json（本插件未验证该路径）。
- Docker 镜像内置：如需，把 dsh-oh-my-dsh-config 以 file:../plugins/dsh-oh-my-dsh-config 加进
  my-custom/plugins-web/package.json 的 dependencies 与 dsh.profile.bundles（seed 层用非 frozen
  安装，不需要预先重生成 lockfile）。

## 回退

删除 profile 里的这一行（或 dsh plugin remove）即可。本插件不写任何持久状态：删除后标题回到构建期
常量，标题提供器回到 base 层取值。

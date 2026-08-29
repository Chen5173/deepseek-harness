# dsh-oh-my-dsh-config

Oh-My-Dsh 个人定制的提取件：**零内核源码改动**，把三项定制从 fork 的 packages/ diff 里搬出来。

| 内容 | 承载方式 | 对应原定制 |
|---|---|---|
| 会话标题提供器（整段对话总结）与其预算参数 | 纯配置：本插件 cordis.patch.yml 层 | 定制 4(c) 的配置部分 |
| 浏览器标签页品牌标题 | 宿主半边：经 webserver/index-inject 注入「全局变量 + 页内脚本」两行 | 定制 5 的标题部分 |
| 侧栏多行品牌块 | 客户端半边注册 sidebar.brand.name 槽 + 挂载后 inline style 放宽外壳几何 + 宿主半边注入 <style> 管自身元素样式 | 定制 5 的侧栏部分 |

## 目录

- package.json：dsh.bundle.patch 声明 + dsh.client 声明；无构建步骤（宿主 src/ 直发，客户端 lib/client.js 手写工厂包）
- dsh.plugin.json：fork 侧插件清单
- cordis.patch.yml：① 停用 base 标题行 + 插入 all-prompts 行；② 挂载本插件
- src/index.js：宿主半边，计算品牌事实、注册首页注入（全局 + 标题脚本 + 侧栏样式）
- src/title-fix.js：页内脚本源码（单独成文件，便于阅读与语法校验）
- lib/client.js：客户端半边（手写 __ModuleLoader__ 工厂包），注册侧栏品牌名槽
- scripts/verify.mjs：40+ 项断言，覆盖 patch 组合语义 + 注入行 + 生产渲染 + 假 DOM 行为 + 客户端 bundle 形状与槽注册
- scripts/verify-cordis-emit.mjs：真实 cordis 上下文里的事件收发放验

## 安装

~~~sh
dsh plugin --profile web add C:/Nt/dsh/my-custom/plugins/dsh-oh-my-dsh-config
# 然后重启 dsh web：宿主与客户端插件都需要重启加载，重启会断开当前 GUI 会话
~~~

客户端半边说明：本插件**没有构建步骤**。浏览器侧模块系统要求 /plugins/<id>/client.js
是 window.__ModuleLoader__.load({ id, factory }) 工厂格式（react / @deepseek-ai/cordis /
@deepseek-ai/dsh-client-ui-slots 都走模块表 require，不打包），所以 lib/client.js 是**手写
维护**的工厂包；改组件逻辑时请同步更新它并跑 scripts/verify.mjs。

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
   构建期可能注入的同串），未知产品标题一律不动，并用 MutationObserver 跟踪 React 之后的写入。

## 侧栏品牌块的实现（第三项）

- **槽**：sidebar.brand.name 是 ui-sidebar 声明的 single 槽；客户端半边在 apply 里
  ctx.slots.register({ name: 'sidebar.brand.name', id: 'dsh-oh-my-dsh-config-brand', priority: -1 }, BrandNameBlock)。
  priority -1 让本槽压过外壳回退；同优先级冲突才抛错（见 packages/client/ui-slots/src/index.ts），
  brand.name 目前没有别的插件占用。
- **文案来源**：宿主半边把 { brand, release, build, commit, title } 写进
  globalThis.__DSH_OHMY_BRAND__（index-inject 的 global 行），客户端组件直接读它——不再依赖
  构建期 DSH_CLIENT_BRAND/_RELEASE/_BUILD（scripts/build.ts 已回退上游）。
- **几何**：外壳的 .logoRow/.brandIdentity/.brandName 是 CSS Modules 哈希类名且固定 60px/24px +
  overflow:hidden，多行内容会被裁。客户端组件挂载后经 ref 拿到自己的根元素，直接给祖先盒子设
  inline style（.brandName/.brandIdentity → height:auto，.logoRow → 66px）——**不写任何哈希类名、
  不依赖 :has()**（老浏览器不支持），inline style 优先级最高，随组件卸载自动消失。折叠 rail 态
  不渲染品牌槽，组件不挂载、inline style 不产生，36px 几何不受影响。
- **宿主注入的 <style> 只管本组件自己元素的样式**（[data-ohmy-brand] 与 .omd-brand-*：布局、字号、
  颜色——简单属性/类选择器，全浏览器支持），不做祖先几何。
- **非 fork 安全**：__DSH_OHMY_BRAND__ 缺失时（官方检出 / 宿主半边未激活）客户端半边整体跳过
  槽注册，外壳回退显示官方占位名——与宿主半边「按基线标记文件自检」语义一致。

## 验证

~~~sh
node my-custom/plugins/dsh-oh-my-dsh-config/scripts/verify.mjs
node my-custom/plugins/dsh-oh-my-dsh-config/scripts/verify-cordis-emit.mjs
~~~

两条脚本都不依赖 cwd、不启动服务、不写仓库状态。verify.mjs 走的是**生产解析路径**
（appBoot.loadOverlayPatches + composeEntries）与**生产渲染器**（renderIndexInjections），
客户端半边则用假 react / 假 slots 直接执行手写工厂包，断言注册行为与渲染结构。

页面级判据（安装并重启后）：标签页显示 Oh-My-Dsh <release> cv.<build>；点开任一有标题的会话后
变成「<会话标题> — Oh-My-Dsh <release> cv.<build>」；侧栏品牌区显示三行（品牌 / 版本 / commit）；
**无需**重跑 pnpm run build。

## 源码侧已回退：本插件是唯一承载

- packages/bundle/base/cordis.patch.yml 的 session-title-llm 行已改回上游取值
  （first-prompt-llm / targetWords 5 / targetCjkCharacters 10 / maxInputBytes 4096 / maxOutputTokens 64），
  该文件与上游**零差异**。
- packages/client/ui-sidebar/src/client/SidebarRoot.tsx 与 SidebarRoot.module.css 的品牌块
  已回退上游（模块 css 里仅保留无关的 footerActions 折叠改动）；scripts/build.ts 的品牌注入
  与 scripts/oh-my-dsh-version.ts 已删除。侧栏品牌 = 本插件客户端半边，标签页品牌 = 本插件
  宿主半边，dsh -V = apps/cli/src/bin.ts 运行时直读版本文件（CLI 层，插件不可达）。

装了本插件 → 上述品牌与标题全部生效；删了它（或换到未装它的 profile）→ 全部回到上游行为，
**不会**残留半套定制。verify.mjs 的断言就是在钉「唯一承载」这件事。

## 尚未搬出源码的部分（以及原因）

- dsh -V 的品牌输出：apps/cli/src/bin.ts 在任何插件挂载之前，属 CLI 层，插件不可达。
- packages/bundle/base/package.json 里对 @deepseek-ai/dsh-session-title-all-prompts-llm 的 1 行
  依赖声明：workspace 解析需要它，保留成本极低。若要彻底移出源码，得把该依赖加进 profile 的
  package.json（本插件未验证该路径）。
- Docker 镜像内置：如需，把 dsh-oh-my-dsh-config 以 file:../plugins/dsh-oh-my-dsh-config 加进
  my-custom/plugins-web/package.json 的 dependencies 与 dsh.profile.bundles（seed 层用非 frozen
  安装，不需要预先重生成 lockfile）。客户端半边不打包依赖，镜像里不需要额外的 react 等安装。

## 回退

删除 profile 里的这一行（或 dsh plugin remove）即可。本插件不写任何持久状态：删除后标题回到构建期
常量、侧栏回到外壳单行回退、标题提供器回到 base 层取值。

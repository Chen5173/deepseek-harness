// 验证 dsh-oh-my-dsh-config 的三项提取是否成立：不启动服务、不写仓库状态。
// （标题提供器配置、标签页标题、侧栏品牌块——含手写客户端 bundle 的形状与槽注册。）
// 从仓库根之外任意目录运行均可（路径按脚本自身位置解析）。
//   node my-custom/plugins/dsh-oh-my-dsh-config/scripts/verify.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 仓库根：scripts -> 插件目录 -> plugins -> my-custom -> 根。
const ROOT = new URL('../../../../', import.meta.url)
const at = (relative) => fileURLToPath(new URL(relative, ROOT))

const appBoot = await import(new URL('packages/boot/app-boot/lib/index.js', ROOT))
const webserver = await import(new URL('packages/host/webserver/lib/index.js', ROOT))
const plugin = await import(new URL('my-custom/plugins/dsh-oh-my-dsh-config/src/index.js', ROOT))

let fails = 0
/* 断言一条检查结果；不一致时打印实际值并计数。 */
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) fails++
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (ok ? '' : '  actual=' + JSON.stringify(actual) + ' expected=' + JSON.stringify(expected)))
}

// ---------- 1) profile patch 组合：停用 base 标题行 + 插入 all-prompts 行 ----------
// 用生产解析器 loadOverlayPatches（与 --patch / profile patch 层同一条路径），
// 顺带证明 cordis 的 !!js 标签不影响本层的行结构。
const layers = [
  'packages/bundle/base/cordis.patch.yml',
  'packages/bundle/web-app/cordis.patch.yml',
  'my-custom/plugins/dsh-oh-my-dsh-config/cordis.patch.yml',
].map(f => appBoot.loadOverlayPatches('dsh-verify', at(f)))
const rows = appBoot.composeEntries(layers)
const titleRow = rows.find(r => r.id === 'session-title-llm')
const ohmyRow = rows.find(r => r.id === 'session-title-all-prompts')
const pluginRow = rows.find(r => r.id === 'dsh-oh-my-dsh-config')

check('base 标题行被停用', titleRow && titleRow.disabled, true)
check('all-prompts 行已插入', ohmyRow && ohmyRow.name, '@deepseek-ai/dsh-session-title-all-prompts-llm')
check('config 为整行替换后的完整值', ohmyRow && ohmyRow.config, {
  targetWords: 12, targetCjkCharacters: 24, maxInputBytes: 32768, maxOutputTokens: 128,
  timeoutMs: 60000, reasoningEffort: 'off', includeAssistantReplies: true,
})
check('reasoningEffort 解析成字符串而非布尔', typeof (ohmyRow && ohmyRow.config.reasoningEffort), 'string')
check('插件行自身已挂载', pluginRow && pluginRow.name, 'dsh-oh-my-dsh-config')
check('仅一个标题提供器在跑', rows.filter(r => String(r.id).startsWith('session-title-') && !r.disabled).length, 1)

// ---------- 2) 宿主半边：首页注入行 ----------
const handlers = []
const fakeCtx = { on: (evt, fn) => { handlers.push([evt, fn]) } }
plugin.apply(fakeCtx, { brand: 'Oh-My-Dsh', baseFile: 'my-custom/oh-my-dsh-base.txt', refreshMs: 0 })
check('监听的事件名', handlers.map(h => h[0]), ['webserver/index-inject'])
const table = []
for (const [, fn] of handlers) fn(table)
check('注入行数', table.length, 3)
check('行种类顺序', table.map(r => r.kind), ['global', 'script', 'style'])
const brandValue = table[0] && table[0].value
console.log('  brand =', JSON.stringify(brandValue))
check('全局变量名', table[0] && table[0].name, '__DSH_OHMY_BRAND__')
check('品牌标题格式', /^Oh-My-Dsh [^ ]+ cv\.1\.0\.\d+$/.test(String(brandValue && brandValue.title)), true)
check('脚本正文不含结束 script 标签', /<\/script/i.test(table[1].text), false)
const styleText = table[2] && table[2].text
check('样式行存在且锚定 data-ohmy-brand', typeof styleText === 'string' && styleText.includes('[data-ohmy-brand]'), true)
check('样式行只含简单选择器（无 :has）', typeof styleText === 'string' && !styleText.includes(':has('), true)
check('样式行不含结束 style 标签', /<\/style/i.test(String(styleText)), false)

// ---------- 3) 真渲染：结构化行 -> index.html ----------
const html = '<!doctype html><html><head><title>DSH Local Build</title></head><body><div id=root></div></body></html>'
const rendered = webserver.renderIndexInjections(html, table)
check('渲染后含全局赋值', rendered.includes('globalThis["__DSH_OHMY_BRAND__"]'), true)
check('全局赋值在脚本行之前', rendered.indexOf('__DSH_OHMY_BRAND__') < rendered.indexOf('MutationObserver'), true)

// ---------- 4) 页内脚本行为（最小假 DOM） ----------
const observers = []
class FakeMO { constructor(cb) { this.cb = cb; observers.push(this) } observe() {} }
/* 在假 DOM 里跑一遍注入脚本，断言标题改写结果。reactWrite 为 null 表示不模拟 React 后写。 */
function runCase(name, initial, reactWrite, expected) {
  const titleEl = { nodeType: 1 }
  const doc = {
    title: initial,
    readyState: 'complete',
    head: {},
    querySelector: sel => (sel === 'title' ? titleEl : null),
    addEventListener: () => {},
  }
  const savedMO = globalThis.MutationObserver
  const savedBrand = globalThis.__DSH_OHMY_BRAND__
  globalThis.MutationObserver = FakeMO
  globalThis.document = doc
  globalThis.__DSH_OHMY_BRAND__ = brandValue
  new Function(table[1].text)()
  if (reactWrite !== null) {
    doc.title = reactWrite
    for (const o of observers) o.cb()
  }
  const got = doc.title
  globalThis.document = undefined
  globalThis.MutationObserver = savedMO
  globalThis.__DSH_OHMY_BRAND__ = savedBrand
  check(name, got, expected === '@BRAND' ? brandValue.title : expected)
}
const T = brandValue.title
runCase('官方占位标题被换成品牌', 'DSH Local Build', null, '@BRAND')
runCase('React 后写会话标题仍保留会话前缀', 'DSH Local Build', '重构侧栏 — DSH Local Build', '重构侧栏 — ' + T)
runCase('未知产品标题不动', 'SomeOtherApp', 'A — SomeOtherApp', 'A — SomeOtherApp')
runCase('构建期已是品牌时幂等', T, 'X — ' + T, 'X — ' + T)

// ---------- 5) 非 fork 检出：找不到基线标记时必须静默不注入 ----------
{
  const h2 = []
  plugin.apply({ on: (evt, fn) => { h2.push(fn) } }, { baseFile: 'definitely-not-a-fork-marker/nope.txt' })
  const t2 = []
  for (const fn of h2) fn(t2)
  check('非 fork 检出不产生注入行', t2.length, 0)
}


// ---------- 6) 客户端半边：手写 bundle 的形状与槽注册 ----------
{
  const pkgJson = JSON.parse(readFileSync(at('my-custom/plugins/dsh-oh-my-dsh-config/package.json'), 'utf8'))
  check('dsh.client.platform 为 web', pkgJson.dsh && pkgJson.dsh.client && pkgJson.dsh.client.platform, 'web')
  check('exports[./client] 指向手写 bundle', pkgJson.exports && pkgJson.exports['./client'], './lib/client.js')
  const bundle = readFileSync(at('my-custom/plugins/dsh-oh-my-dsh-config/lib/client.js'), 'utf8')
  check('bundle 注册进 __ModuleLoader__', /window\.__ModuleLoader__\.load\(\{/.test(bundle), true)
  check('bundle id 为包名', /id: "dsh-oh-my-dsh-config"/.test(bundle), true)

  let handoff
  const savedWindow = globalThis.window
  globalThis.window = { __ModuleLoader__: { load: (h) => { handoff = h } } }
  let registered
  const reactCalls = []
  const effects = []
  const fakeReact = {
    createElement: (type, props, ...children) => {
      reactCalls.push({ type, props, children })
      return { type, props, children }
    },
    useRef: (initial) => ({ current: initial === undefined ? null : initial }),
    useEffect: (fn) => { effects.push(fn) },
  }
  new Function(bundle)()
  const mod = handoff.factory((spec) => {
    if (spec === 'react') return fakeReact
    throw new Error('unexpected require: ' + spec)
  })
  globalThis.window = savedWindow
  check('客户端插件名', mod.name, 'dsh-oh-my-dsh-config/client')
  check('客户端 inject 含 slots', Array.isArray(mod.inject) && mod.inject.includes('slots'), true)

  const savedBrand = globalThis.__DSH_OHMY_BRAND__
  globalThis.__DSH_OHMY_BRAND__ = undefined
  mod.apply({ slots: { register: (opts, comp) => { registered = [opts, comp] } } })
  check('非 fork（无全局）时不注册槽', registered, undefined)
  globalThis.__DSH_OHMY_BRAND__ = { brand: 'Oh-My-Dsh', release: '0.1.1-rc.2', build: 'cv.1.0.1', commit: 'abc1234' }
  registered = undefined
  mod.apply({ slots: { register: (opts, comp) => { registered = [opts, comp] } } })
  check('fork 检出时注册 brand.name 槽', registered && registered[0] && registered[0].name, 'sidebar.brand.name')
  check('注册优先级 -1（压过外壳回退）', registered && registered[0] && registered[0].priority, -1)
  effects.length = 0
  const el = registered[1]()
  check('品牌块根元素带 data-ohmy-brand', el && el.props && el.props['data-ohmy-brand'], true)
  check('品牌块含品牌行', reactCalls.some(c => c.type === 'span' && c.props && c.props.className === 'omd-brand-line'), true)
  check('品牌块含版本行', reactCalls.some(c => c.type === 'span' && c.props && c.props.className === 'omd-brand-meta'), true)
  check('品牌块含 commit 行', reactCalls.some(c => c.type === 'span' && c.props && c.props.className === 'omd-brand-meta'
    && Array.isArray(c.children) && c.children.some(ch => typeof ch === 'string' && ch.startsWith('commit: '))), true)

  // 几何放宽：模拟 React 挂载（ref 指向真实 DOM 链）后跑一次 effect，断言祖先盒子被放宽。
  const brandRow = { style: {} }
  const brandButton = { style: {}, parentElement: brandRow }
  const identity = { style: {}, parentElement: brandButton }
  const nameBox = { style: {}, parentElement: identity }
  const brandEl = { style: {}, parentElement: nameBox }
  const anchor = el.props.ref
  anchor.current = brandEl
  check('挂载 effect 已注册', effects.length, 1)
  effects[0]()
  check('brandName 放宽高度', nameBox.style.height, 'auto')
  check('brandName 内容顶对齐', nameBox.style.alignItems, 'flex-start')
  check('brandIdentity 放宽高度', identity.style.height, 'auto')
  check('logoRow 放宽到 66px', brandRow.style.height, '66px')
  globalThis.__DSH_OHMY_BRAND__ = savedBrand
}

console.log(fails === 0 ? '\nALL_CHECKS_PASSED' : '\n' + String(fails) + ' CHECK(S) FAILED')
process.exit(fails === 0 ? 0 : 1)

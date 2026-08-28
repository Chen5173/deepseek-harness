// Verifies the DOM-injected "delete session" row in the sidebar session-row
// "..." menu, without a browser.
//
// Why this exists: the row menu is hard-coded in ui-workspace with no row-level
// slot, and it renders through a React portal, so the plugin can only reach it
// at the DOM level. That glue is exactly what silently stops working when the
// shell's markup moves, so this script pins the contract against a DOM built to
// the shell's real shape (packages/client/ui-primitives/src/Menu.tsx plus
// packages/client/ui-workspace/src/client/rows/Rows.tsx):
//
//   [role=menu]                       portaled to body, fixed position
//     div.<hash>_viewport role=presentation
//       div.<hash>_itemWrap
//         button[role=menuitem].<hash>_item
//           span.<hash>_itemIcon + span.<hash>_itemLabel
//     div.<hash>_separator
//   ...and the owning row: div.<hash>_sessionRow.<hash>_menuOpen with
//   span.<hash>_title and span.<hash>_rowActions > button (the "..." trigger).
//
// CSS-module names are emitted as "<hash>_<local>" (observed: z_yZ2G_sessionRow),
// which is what the injection's substring selectors rely on.
//
// Run: node my-custom/vendor-plugins/dsh-plugin-session-delete/scripts/verify-menu-injection.mjs
// No cwd assumptions, no server, no repository writes.

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const here = dirname(fileURLToPath(import.meta.url))
const pluginDir = resolve(here, '..')
const clientSource = readFileSync(join(pluginDir, 'src', 'client.js'), 'utf8')

let failures = 0
let checks = 0
function check(what, actual, expected) {
  checks += 1
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  if (!pass) failures += 1
  console.log((pass ? 'PASS ' : 'FAIL ') + what
    + (pass ? '' : '  expected=' + JSON.stringify(expected) + ' actual=' + JSON.stringify(actual)))
}
function ok(what, condition, detail) {
  checks += 1
  if (!condition) failures += 1
  console.log((condition ? 'PASS ' : 'FAIL ') + what
    + (condition || detail === undefined ? '' : '  ' + detail))
}

const H = 'z_yZ2G'
const row = '<div class="' + H + '_sessionRow ' + H + '_menuOpen" role="treeitem">'
  + '<span class="' + H + '_slot"></span>'
  + '<span class="' + H + '_title">重构会话标题链路</span>'
  + '<span class="' + H + '_time">5 分钟前</span>'
  + '<span class="' + H + '_rowActions"><button type="button" aria-label="会话操作"></button></span>'
  + '</div>'
function itemRow(label) {
  return '<div class="' + H + '_itemWrap"><button type="button" role="menuitem" class="' + H + '_item">'
    + '<span class="' + H + '_itemIcon"></span><span class="' + H + '_itemLabel">' + label + '</span>'
    + '</button></div>'
}
const menu = '<div role="menu" class="' + H + '_list">'
  + '<div class="' + H + '_viewport" role="presentation">'
  + itemRow('重命名')
  + '<div class="' + H + '_separator" role="separator"></div>'
  + itemRow('归档会话')
  + '</div></div>'
const html = '<!doctype html><html><head><style>'
  + '.' + H + '_danger { color: var(--dsw-alias-state-error-primary); }'
  + '.' + H + '_item { min-height: 40px; }'
  + '</style></head><body>' + row + menu + '</body></html>'

// runScripts: "outside-only" gives window.eval a real window global, which is
// how the client bundle is loaded in the browser (a classic script, not a module).
const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'outside-only' })
const { window } = dom
// The page's active language normally arrives through the client locale
// service; without it the plugin sniffs the browser language. Pin zh so the
// Chinese copy is what gets asserted.
Object.defineProperty(window.navigator, 'languages', { value: ['zh-CN', 'zh'] })
// jsdom performs no layout: getClientRects() is always empty, which the
// injection reads as "not rendered". Give it a layout-shaped stand-in so the
// visibility guard is exercised rather than trivially failed.
window.Element.prototype.getClientRects = function () {
  return window.getComputedStyle(this).display === 'none' ? [] : [{}]
}

// --- load the plugin's client half -------------------------------------------
const requires = {
  react: {
    createElement: () => null,
    useCallback: (fn) => fn,
    useEffect: () => {},
    useState: () => [null, () => {}],
  },
  '@deepseek-ai/dsh-client-ui-primitives': { IconTrashOutline16: () => null, Modal: () => null },
}
let loaded = null
window.__ModuleLoader__ = {
  load: (registration) => {
    loaded = { id: registration.id, exports: registration.factory((name) => requires[name]) }
  },
}
window.eval(clientSource)
check('client 模块 id', loaded && loaded.id, '@huanlin/dsh-plugin-session-delete')

const injected = []
const ctx = {
  get: (service) => (service === 'sessions' ? { list: { getSnapshot: () => ({ byId: {}, ids: [] }) } } : null),
  inject: (names) => { injected.push(names) },
  on: () => {},
  slots: { inject: () => () => {}, register: () => () => {} },
  effect: () => {},
}
loaded.exports.apply(ctx)
ok('声明的服务依赖', injected.length > 0, 'injected=' + JSON.stringify(injected))

// --- the injected row --------------------------------------------------------
const viewport = window.document.querySelector('[class*=_viewport]')
const item = window.document.querySelector('[data-chameleon-delete]')

ok('注入项存在（apply 时同步注入一次）', item !== null)
if (item) {
  const wrap = item.closest('[class*=_itemWrap]') || item
  check('role', item.getAttribute('role'), 'menuitem')
  ok('落在 viewport 内（跟随菜单滚动容器，不被高度上限裁掉）', wrap.parentElement === viewport,
    'parent=' + (wrap.parentElement && wrap.parentElement.className))
  check('位于菜单最底部', viewport.lastElementChild === wrap, true)
  check('复用真实 item 的 class', item.className.indexOf(H + '_item') >= 0, true)
  ok('带上外壳的 danger class', item.className.indexOf(H + '_danger') >= 0, 'class=' + item.className)
  ok('红色兜底内联样式', String(item.style.color).indexOf('--dsw-alias-state-error-primary') >= 0,
    'color=' + item.style.color)
  check('文案（zh）', item.querySelector('[class*=_itemLabel]').textContent, '删除会话')
  ok('图标是垃圾桶 svg', /svg/i.test(item.querySelector('[class*=_itemIcon]').innerHTML || ''), '')
  ok('分隔线在注入项之前', viewport.children[viewport.children.length - 2].getAttribute('role'), 'separator')
  check('文案没写进图标 span', item.querySelector('[class*=_itemIcon]').textContent, '')
}

// --- idempotency -------------------------------------------------------------
window.document.body.appendChild(window.document.createTextNode('x'))
await new Promise((done) => window.setTimeout(done, 0))
check('重复 mutation 不产生第二项', window.document.querySelectorAll('[data-chameleon-delete]').length, 1)

// --- click path --------------------------------------------------------------
const dispatched = []
window.addEventListener('chameleon:delete-session', (e) => { dispatched.push(e.detail) })
const trigger = window.document.querySelector('[class*=_rowActions] button')
let triggerClicked = 0
trigger.addEventListener('click', () => { triggerClicked += 1 })
item.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
check('点击派发一次删除事件', dispatched.length, 1)
check('事件带的是行标题', dispatched[0] && dispatched[0].title, '重构会话标题链路')
check('点击顺带关掉行菜单（复用触发器，不切换会话）', triggerClicked, 1)

// --- workspace-prefixed title ------------------------------------------------
window.document.querySelector('[class*=_title]').textContent = '[dsh] 带工作区前缀的会话'
dispatched.length = 0
window.document.querySelector('[data-chameleon-delete]')
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
check('剥掉侧栏的 [工作区] 前缀后再匹配', dispatched[0] && dispatched[0].title, '带工作区前缀的会话')

// --- negative: a menu that is not a session row's -----------------------------
const other = window.document.createElement('div')
other.setAttribute('role', 'menu')
other.innerHTML = '<div class="' + H + '_viewport">' + itemRow('模型') + '</div>'
window.document.body.appendChild(other)
window.document.querySelector('[class*=_sessionRow]').className = H + '_sessionRow' // menu closed
await new Promise((done) => window.setTimeout(done, 0))
check('非会话行菜单不被注入', other.querySelectorAll('[data-chameleon-delete]').length, 0)

console.log('')
console.log((failures === 0 ? 'ALL_CHECKS_PASSED' : 'CHECKS_FAILED') + ' (' + (checks - failures) + '/' + checks + ')')
process.exit(failures === 0 ? 0 : 1)

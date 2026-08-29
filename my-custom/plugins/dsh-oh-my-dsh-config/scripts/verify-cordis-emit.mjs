// 验真最后一环：在真实 cordis 上下文里，插件的 ctx.on('webserver/index-inject')
// 能否收到 webserver 的 emit，并经生产渲染器落到 index.html。
//   node my-custom/plugins/dsh-oh-my-dsh-config/scripts/verify-cordis-emit.mjs

const ROOT = new URL('../../../../', import.meta.url)
// 按包名解析不到 cordis（workspace 依赖装在包内 node_modules），直接取真实路径：
// node_modules 里的 @deepseek-ai/cordis 是指向 vendor/cordis 的链接。
const { Context } = await import(new URL('vendor/cordis/lib/index.js', ROOT))
const webserver = await import(new URL('packages/host/webserver/lib/index.js', ROOT))
const plugin = await import(new URL('my-custom/plugins/dsh-oh-my-dsh-config/src/index.js', ROOT))

const ctx = new Context()
await ctx.plugin(plugin, { brand: 'Oh-My-Dsh', baseFile: 'my-custom/oh-my-dsh-base.txt', refreshMs: 0 })
for (let i = 0; i < 8; i++) await Promise.resolve()

const table = []
await ctx.emit('webserver/index-inject', table)
console.log('rows received in a real cordis context:', table.length)
console.log('kinds:', table.map(r => r.kind).join(','))
const globalRow = table.find(r => r.kind === 'global')
console.log('global name:', globalRow && globalRow.name, '| title:', globalRow && globalRow.value.title)

const html = '<html><head><title>DSH Local Build</title></head><body></body></html>'
const rendered = webserver.renderIndexInjections(html, table)
console.log('rendered head carries brand global + observer:',
  rendered.includes('__DSH_OHMY_BRAND__') && rendered.includes('MutationObserver'))
process.exit(table.length === 2 ? 0 : 1)

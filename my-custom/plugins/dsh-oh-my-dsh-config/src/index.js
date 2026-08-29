// dsh-oh-my-dsh-config：Oh-My-Dsh 个人定制提取件（宿主半边）。
//
// 只做一件官方没给源码口子、但留了注入面的事：浏览器标签页标题。
// 官方标题是构建期常量（DSH_CLIENT_TITLE 在 tsdown 阶段 define 进 bundle，由
// packages/client/ui-renderer/src/client/DocumentTitle.tsx 读取），改它本要重编内核；
// 但 webserver 提供结构化首页注入面（webserver/index-inject 事件），于是可以在运行时
// 把产品标题换成 fork 品牌——不重跑 pnpm run build 也生效。
//
// 会话标题提供器的选择与参数不在这里做：那是纯配置，见同目录 cordis.patch.yml。
//
// ESM 模块（cordis bundle 约定）：具名导出 name / inject / apply。

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const name = 'dsh-oh-my-dsh-config'

// 无硬依赖：只监听 webserver 的首页注入事件；终端 profile 永不触发，即零副作用。
const inject = []

/** 官方未注入 DSH_CLIENT_TITLE 时，bundle 里的回退产品标题。 */
const OFFICIAL_PLACEHOLDER_TITLE = 'DSH Local Build'

/** 基线标记文件的合法内容：一个 7~40 位十六进制提交号。 */
const BASE_COMMIT_RE = /^[0-9a-f]{7,40}$/iu

/** 显式 build 版本文件的相对仓库根路径（内容形如 1.0.1，X.Y.Z）。 */
const BUILD_VERSION_FILE = 'my-custom/oh-my-dsh-build.txt'

/** build 版本内容的合法形态：X.Y.Z。 */
const BUILD_VERSION_RE = /^\d+\.\d+\.\d{1,6}$/

/** 页内脚本源码：单独成文件便于阅读与校验，插件加载时读一次。 */
const TITLE_FIX_SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'title-fix.js'), 'utf8')

/**
 * 从候选目录向上找仓库根：判据是「同一目录下既有 package.json 又有基线标记文件」。
 * 用于支持从仓库任意子目录启动 dsh web。
 * @param start - 起始目录绝对路径，例如 process.cwd()。
 * @param baseFile - 基线标记文件相对仓库根的路径，例如 my-custom/oh-my-dsh-base.txt。
 * @param limit - 最多向上跳几级（防御性上限）。
 * @returns 仓库根绝对路径，找不到时返回 undefined。
 */
function findRepoRoot(start, baseFile, limit) {
  let current = resolve(start)
  for (let hop = 0; hop <= (limit ?? 6); hop++) {
    if (existsSync(join(current, 'package.json')) && existsSync(join(current, baseFile))) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
  return undefined
}

/**
 * 执行一条 git 命令并返回去除首尾空白的输出；失败（非 git 仓库、缺 git）返回 undefined。
 * @param args - git 参数数组，例如 ['rev-parse', '--short=7', 'HEAD']。
 * @param cwd - 执行目录。
 * @returns 命令标准输出文本，或 undefined。
 */
function gitText(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}

/**
 * 计算 fork 品牌事实：release 取仓库根 package.json，build 读显式版本文件
 * my-custom/oh-my-dsh-build.txt（不再按 commit 数推导——commit 不改变版本，
 * 只有发版/push 前跑 bump-build 脚本才 patch +1）。
 * 基线标记缺失或格式不合法即判定「不是 fork 检出」，返回 undefined 让调用方静默跳过。
 * @param root - 仓库根绝对路径。
 * @param baseFile - 基线标记文件相对根路径。
 * @param brand - 品牌名，例如 Oh-My-Dsh。
 * @returns 品牌事实（含标题字符串），或 undefined。
 */
function readBrand(root, baseFile, brand) {
  const base = readFileSync(join(root, baseFile), 'utf8').trim()
  if (!BASE_COMMIT_RE.test(base)) return undefined
  let release = '0.0.0'
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    if (typeof manifest.version === 'string') release = manifest.version
  } catch {
    // 读不到 package.json 就用占位版本：标题少个 release，远好过首页渲染失败。
  }
  // build 读显式版本文件；允许 DSH_OH_MY_DSH_BUILD 显式覆盖（Docker 构建上下文里没有 .git）。
  const override = process.env.DSH_OH_MY_DSH_BUILD
  let derived = '1.0.0'
  try {
    const candidate = readFileSync(join(root, BUILD_VERSION_FILE), 'utf8').trim()
    if (BUILD_VERSION_RE.test(candidate)) derived = candidate
  } catch {
    // 读不到版本文件就退回占位 1.0.0：标题少个 build，远好过首页渲染失败。
  }
  const build = typeof override === 'string' && override !== '' ? override : derived
  const commit = gitText(['rev-parse', '--short=7', 'HEAD'], root) ?? ''
  return { brand, release, build, commit, title: brand + ' ' + release + ' cv.' + build }
}

/**
 * 插件入口：注册首页注入监听，把 fork 品牌作为「全局变量 + 页内脚本」两行交给 webserver。
 * @param ctx - cordis 插件上下文。
 * @param config - 条目 config（字段含义见 cordis.patch.yml），全部可省略。
 */
function apply(ctx, config) {
  const options = config ?? {}
  const brand = typeof options.brand === 'string' && options.brand !== '' ? options.brand : 'Oh-My-Dsh'
  const baseFile = typeof options.baseFile === 'string' && options.baseFile !== '' ? options.baseFile : 'my-custom/oh-my-dsh-base.txt'
  const refreshMs = typeof options.refreshMs === 'number' && Number.isFinite(options.refreshMs)
    ? Math.max(0, options.refreshMs)
    : 60000
  const root = findRepoRoot(process.env.DSH_OHMY_REPO_ROOT ?? process.cwd(), baseFile)

  // git 计数只在过期后重算；失败结果同样缓存，避免每次首页请求都 fork 一个 git 进程。
  let cache = { at: 0, value: undefined, computed: false }
  /** 取当前品牌事实（带 TTL 缓存）；非 fork 检出返回 undefined。 */
  function brandNow() {
    if (root === undefined) return undefined
    const now = Date.now()
    if (!cache.computed || now - cache.at > refreshMs) {
      cache = { at: now, value: readBrand(root, baseFile, brand), computed: true }
    }
    return cache.value
  }

  ctx.on('webserver/index-inject', (table) => {
    let facts
    try {
      facts = brandNow()
    } catch {
      return // 任何计算异常都不该影响首页渲染
    }
    if (facts === undefined) return
    // replaces 同时收录官方占位名与本 fork 构建期可能已注入的同串标题：前者覆盖不带品牌 env
    // 构建的 bundle，后者让「构建期已经改过品牌」成为幂等空操作。
    const replaces = [OFFICIAL_PLACEHOLDER_TITLE, facts.title]
    table.push(
      { kind: 'global', name: '__DSH_OHMY_BRAND__', value: { brand: facts.brand, release: facts.release, build: facts.build, commit: facts.commit, title: facts.title, replaces } },
      { kind: 'script', placement: 'head', text: TITLE_FIX_SOURCE },
    )
  })
}

export { apply, inject, name }

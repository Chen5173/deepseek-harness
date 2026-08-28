#!/usr/bin/env node
/**
 * dsh — command-line entry. Dynamic imports per mode keep unrelated modes out
 * of each dispatch path; the adapter prints and exits for
 * `--help`/`--version`/a parse error, so only a valid mode reaches the switch.
 * @module @deepseek-ai/dsh/bin
 */

/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { parseDshArgs } from './args.ts'

// Both the source tree (apps/cli/src) and the bundled bin (apps/cli/lib) sit
// one directory under apps/cli, so the checked-in manifest (and the repository
// root two hops up from either artifact) resolves with the same relative hops.
/**
 * Personal-fork build facts for `--version`. Active only inside the fork:
 * the base-commit marker file is what makes a checkout Oh-My-Dsh, so upstream
 * or installed builds without it keep the plain release version. The version
 * is `cv.1.0.<count-1>` (`cv.1.0.0` after the fork is squashed to one commit).
 */
function ohMyDshBuild(): { active: boolean; number: string } {
  try {
    const root = fileURLToPath(new URL('../../..', import.meta.url))
    const basePath = resolve(root, 'my-custom/oh-my-dsh-base.txt')
    if (!existsSync(basePath)) return { active: false, number: '1.0.0' }
    const base = readFileSync(basePath, 'utf8').trim()
    if (!/^[0-9a-f]{7,40}$/iu.test(base)) return { active: false, number: '1.0.0' }
    const count = Number(
      execFileSync('git', ['rev-list', '--count', 'HEAD', `^${base}`], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    )
    return { active: true, number: `1.0.${Math.max(0, count - 1)}` }
  } catch {
    return { active: false, number: '1.0.0' }
  }
}

/** This app's version, read from its checked-in package.json. */
function readVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  const version = typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  const build = ohMyDshBuild()
  return build.active ? `Oh-My-Dsh ${version} cv.${build.number}` : version
}

const invocation = parseDshArgs(process.argv.slice(2), readVersion())

switch (invocation.mode) {
  case 'profile': {
    const { runProfile } = await import('./profile-boot.ts')
    await runProfile({
      environment: loadLayeredEnv('dsh'),
      profile: invocation.profile,
      patchFiles: invocation.patches,
      pluginsOnly: invocation.pluginsOnly,
      noPlugins: invocation.noPlugins,
      args: invocation.args,
    })
    break
  }
  case 'plugin': {
    const { runPlugin } = await import('./plugin.ts')
    process.exit(runPlugin(invocation.profile, invocation.args))
    break
  }
  case 'dump-config': {
    const { runDumpConfig } = await import('./dump-config.ts')
    runDumpConfig(
      invocation.profile, invocation.defaultOnly, invocation.patches,
      invocation.pluginsOnly, invocation.noPlugins,
    )
    break
  }
  default:
    invocation satisfies never
    throw new Error(`dsh: unhandled invocation mode ${JSON.stringify(invocation)}`)
}

/**
 * Oh-My-Dsh personal-fork build version.
 *
 * The sidebar / document / HTML brand shows `Oh-My-Dsh <release> cv.<major>.<minor>.<patch>`
 * (the same format as `dsh -V`). The version is `cv.1.0.<count-1>`: after the
 * personal series is squashed into a single commit (count = 1) it reads
 * `cv.1.0.0`, and each later commit on top of the fork bumps the patch by one
 * (`cv.1.0.1`, `cv.1.0.2`, ...). scripts/build.ts folds the resulting title into
 * DSH_CLIENT_TITLE so both Vite and the client tsdown bundles inline it; an
 * explicit DSH_CLIENT_TITLE, DSH_OH_MY_DSH_BUILD, or the `official` build
 * profile overrides the derivation.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Personal fork brand prefix (kept in sync with my-custom/README.md). */
const OH_MY_DSH_BRAND = 'Oh-My-Dsh'

/** Repository-relative file holding the base commit of the personal series. */
const OH_MY_DSH_BASE_COMMIT_FILE = 'my-custom/oh-my-dsh-base.txt'

/** Optional explicit build-version override (documented in my-custom/README.md). */
const OH_MY_DSH_BUILD_VARIABLE = 'DSH_OH_MY_DSH_BUILD'

/** Resolve the checked-in release version (all dsh packages share it). */
function repositoryVersion(root: string): string {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

/** Resolve the personal-series build version as `1.0.<patch>` (see header doc). */
function ohMyDshBuildNumber(root: string, environment: NodeJS.ProcessEnv = process.env): string {
  const explicit = environment[OH_MY_DSH_BUILD_VARIABLE]
  if (explicit !== undefined) {
    if (!/^\d+\.\d+\.\d{1,6}$/.test(explicit)) {
      throw new Error(`${OH_MY_DSH_BUILD_VARIABLE} must look like "1.0.0"; got ${JSON.stringify(explicit)}`)
    }
    return explicit
  }
  const basePath = resolve(root, OH_MY_DSH_BASE_COMMIT_FILE)
  if (!existsSync(basePath)) {
    throw new Error(
      `Oh-My-Dsh build number needs ${OH_MY_DSH_BASE_COMMIT_FILE} to exist and hold the base commit of the personal series`,
    )
  }
  const base = readFileSync(basePath, 'utf8').trim()
  if (!/^[0-9a-f]{7,40}$/iu.test(base)) {
    throw new Error(`${OH_MY_DSH_BASE_COMMIT_FILE} must contain a Git commit hash; got ${JSON.stringify(base)}`)
  }
  const count = Number(
    execFileSync('git', ['rev-list', '--count', 'HEAD', `^${base}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim(),
  )
  // cv.1.0.<count-1>: after the fork is squashed to one commit (count = 1),
  // this reads cv.1.0.0; every later commit bumps the patch by one (cv.1.0.1, ...).
  return `1.0.${Math.max(0, count - 1)}`
}

/** Full client title: `Oh-My-Dsh <release> cv.<build>` — identical to `dsh -V`. */
export function ohMyDshClientTitle(root: string, environment: NodeJS.ProcessEnv = process.env): string {
  return `${OH_MY_DSH_BRAND} ${repositoryVersion(root)} cv.${ohMyDshBuildNumber(root, environment)}`
}

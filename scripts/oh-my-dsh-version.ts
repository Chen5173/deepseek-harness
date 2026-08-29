/**
 * Oh-My-Dsh personal-fork build version.
 *
 * The sidebar / document / HTML brand shows `Oh-My-Dsh <release> cv.<major>.<minor>.<patch>`
 * (the same format as `dsh -V`). The version is stored explicitly in
 * `my-custom/oh-my-dsh-build.txt` (e.g. `1.0.1`): commits do NOT change the
 * number — only running my-custom/bump-build.sh (or bump-build.bat) before a
 * release/push bumps the patch by one. scripts/build.ts folds the resulting
 * title into DSH_CLIENT_TITLE so both Vite and the client tsdown bundles inline
 * it; an explicit DSH_CLIENT_TITLE, DSH_OH_MY_DSH_BUILD, or the `official`
 * build profile overrides the derivation.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Personal fork brand prefix (kept in sync with my-custom/README.md). */
const OH_MY_DSH_BRAND = 'Oh-My-Dsh'

/** Repository-relative file holding the current personal-series build version (X.Y.Z). */
const OH_MY_DSH_BUILD_FILE = 'my-custom/oh-my-dsh-build.txt'

/** Optional explicit build-version override (documented in my-custom/README.md). */
const OH_MY_DSH_BUILD_VARIABLE = 'DSH_OH_MY_DSH_BUILD'

/** Resolve the checked-in release version (all dsh packages share it). */
function repositoryVersion(root: string): string {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

/** Resolve the personal-series build version as `X.Y.Z` (see header doc). */
function ohMyDshBuildNumber(root: string, environment: NodeJS.ProcessEnv = process.env): string {
  const explicit = environment[OH_MY_DSH_BUILD_VARIABLE]
  if (explicit !== undefined) {
    if (!/^\d+\.\d+\.\d{1,6}$/.test(explicit)) {
      throw new Error(`${OH_MY_DSH_BUILD_VARIABLE} must look like "1.0.0"; got ${JSON.stringify(explicit)}`)
    }
    return explicit
  }
  const buildPath = resolve(root, OH_MY_DSH_BUILD_FILE)
  if (!existsSync(buildPath)) {
    throw new Error(
      `Oh-My-Dsh build number needs ${OH_MY_DSH_BUILD_FILE} to hold the current build version (e.g. "1.0.1")`,
    )
  }
  const build = readFileSync(buildPath, 'utf8').trim()
  if (!/^\d+\.\d+\.\d{1,6}$/.test(build)) {
    throw new Error(`${OH_MY_DSH_BUILD_FILE} must look like "1.0.0"; got ${JSON.stringify(build)}`)
  }
  return build
}

/** Structured Oh-My-Dsh brand facts: brand name, release, and build stamp. */
export interface OhMyDshBrandParts {
  /** The fork brand name (e.g. `Oh-My-Dsh`). */
  brand: string
  /** The checked-in release version (e.g. `0.1.1-rc.2`). */
  release: string
  /** The personal build stamp (e.g. `cv.1.0.1`). */
  build: string
}

/** The brand name, release version, and per-commit build stamp, separately. */
export function ohMyDshBrandParts(root: string, environment: NodeJS.ProcessEnv = process.env): OhMyDshBrandParts {
  return {
    brand: OH_MY_DSH_BRAND,
    release: repositoryVersion(root),
    build: `cv.${ohMyDshBuildNumber(root, environment)}`,
  }
}

/** Full client title: `Oh-My-Dsh <release> cv.<build>` — identical to `dsh -V`. */
export function ohMyDshClientTitle(root: string, environment: NodeJS.ProcessEnv = process.env): string {
  const { brand, release, build } = ohMyDshBrandParts(root, environment)
  return `${brand} ${release} ${build}`
}

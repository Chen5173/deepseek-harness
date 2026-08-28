/** Run the complete repository build and bind its client artifacts to their public environment. */

import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  CLIENT_BUILD_RECORD_PATH,
  clientBuildProcessEnvironment,
  repositoryCommitHash,
  resolveClientBuildEnvironment,
  writeClientBuildRecord,
} from './client-build-environment.ts'
import { ohMyDshBrandParts, ohMyDshClientTitle } from './oh-my-dsh-version.ts'
import { pnpmInvocation } from './pnpm-invocation.ts'

/** Run one package script through the package manager that invoked this build. */
function runScript(script: string, environment: NodeJS.ProcessEnv): void {
  const invocation = pnpmInvocation(['run', script], environment)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: resolve(import.meta.dirname, '..'),
    env: environment,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`build: ${script} exited with ${String(result.status ?? result.signal)}`)
  }
}

/** Run the full build selected by `--profile` or `DSH_BUILD_CLIENT_PROFILE`. */
function main(): void {
  const { values } = parseArgs({
    options: { profile: { type: 'string' } },
    allowPositionals: false,
  })
  const root = resolve(import.meta.dirname, '..')
  const parentEnvironment = {
    ...process.env,
    DSH_CLIENT_COMMIT_HASH: repositoryCommitHash(root, process.env),
    // Personal forks default to the Oh-My-Dsh brand with a per-commit build
    // number; an explicit DSH_CLIENT_TITLE or the official profile wins. The
    // structured brand facts (brand / release / build) let the sidebar render
    // the multi-line title; the official profile strips every DSH_CLIENT_*
    // value it does not carry itself.
    ...(process.env.DSH_CLIENT_TITLE === undefined
      ? (() => {
        const { brand, release, build } = ohMyDshBrandParts(root, process.env)
        return {
          DSH_CLIENT_BRAND: brand,
          DSH_CLIENT_RELEASE: release,
          DSH_CLIENT_BUILD: build,
          DSH_CLIENT_TITLE: ohMyDshClientTitle(root, process.env),
        }
      })()
      : {}),
  }
  const clientEnvironment = resolveClientBuildEnvironment(parentEnvironment, values.profile)
  const buildEnvironment = clientBuildProcessEnvironment(parentEnvironment, clientEnvironment)

  rmSync(resolve(root, CLIENT_BUILD_RECORD_PATH), { force: true })
  runScript('build:lib', buildEnvironment)
  runScript('build:web', buildEnvironment)
  const record = writeClientBuildRecord(root, clientEnvironment)
  console.log(
    `build: recorded ${String(record.artifacts.fileCount)} client artifact(s) with ${String(Object.keys(record.environment).length)} public value(s)`,
  )
}

if (import.meta.main) main()

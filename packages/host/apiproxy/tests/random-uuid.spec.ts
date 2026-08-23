/** Regression: RPC correlation ids must mint on insecure HTTP origins too. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUuid } from '../src/fetch/random-uuid.ts'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Deterministic filler standing in for crypto.getRandomValues. */
function fakeGetRandomValues(): (bytes: Uint8Array) => Uint8Array {
  let counter = 0
  return (bytes) => {
    for (let index = 0; index < bytes.length; index++) bytes[index] = counter++ & 0xff
    return bytes
  }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('randomUuid', () => {
  it('falls back to getRandomValues when randomUUID is absent (insecure origin)', () => {
    vi.stubGlobal('crypto', { getRandomValues: fakeGetRandomValues() })
    const first = randomUuid()
    const second = randomUuid()
    expect(first).toMatch(UUID_V4)
    expect(second).toMatch(UUID_V4)
    expect(first).not.toBe(second)
  })

  it('falls back when a present randomUUID refuses to run', () => {
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => { throw new Error('insecure context') }),
      getRandomValues: fakeGetRandomValues(),
    })
    expect(randomUuid()).toMatch(UUID_V4)
  })

  it('prefers the native randomUUID in secure contexts', () => {
    const expected = '00000000-0000-4000-8000-000000000000'
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => expected),
      getRandomValues: fakeGetRandomValues(),
    })
    expect(randomUuid()).toBe(expected)
  })
})

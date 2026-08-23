/** Unit coverage for the webserver's optional non-loopback auth gate. */

import { Readable } from 'node:stream'
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import HttpServer from '../src/index.ts'
import {
  AUTH_COOKIE_NAME,
  AUTH_LOGIN_PATH,
  MAX_LOGIN_BODY_BYTES,
  isLoopbackRemote,
  readRequestBody,
  runAuthGate,
  type AuthGateRequest,
} from '../src/auth-gate.ts'

const TOKEN = 's3cret-token-123'

function gateRequest(overrides: Partial<AuthGateRequest> = {}): AuthGateRequest {
  return { headers: {}, method: 'GET', url: '/', remoteAddress: '10.0.0.5', ...overrides }
}

function headers(entries: Record<string, string>): IncomingHttpHeaders {
  return entries
}

describe('non-loopback auth gate', () => {
  it('stays disabled without a configured token', async () => {
    await expect(runAuthGate(undefined, gateRequest(), async () => '')).resolves.toBeUndefined()
  })

  it('always passes loopback sockets, including IPv4-mapped IPv6', async () => {
    for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      await expect(runAuthGate(TOKEN, gateRequest({ remoteAddress }), async () => '')).resolves.toBeUndefined()
    }
  })

  it('treats a missing remote address as remote and fails closed', async () => {
    await expect(runAuthGate(TOKEN, gateRequest({ remoteAddress: undefined }), async () => ''))
      .resolves.toMatchObject({ status: 401 })
  })

  it('redirects unauthenticated document navigations to the login form', async () => {
    const result = await runAuthGate(TOKEN, gateRequest({ headers: headers({ accept: 'text/html' }) }), async () => '')
    expect(result).toMatchObject({ status: 302 })
    expect(result?.headers?.location).toBe(AUTH_LOGIN_PATH)
  })

  it('answers unauthenticated asset and API reads with a plain 401', async () => {
    const result = await runAuthGate(TOKEN, gateRequest({ headers: headers({ accept: 'application/json' }) }), async () => '')
    expect(result).toMatchObject({ status: 401, body: 'unauthorized' })
  })

  it('serves the self-contained login form without authentication', async () => {
    const result = await runAuthGate(TOKEN, gateRequest({ url: AUTH_LOGIN_PATH }), async () => '')
    expect(result).toMatchObject({ status: 200 })
    expect(result?.body).toContain('method="post" action="/login"')
    expect(result?.body).toContain('type="password"')
  })

  it('mints the HttpOnly cookie after a correct login POST', async () => {
    const result = await runAuthGate(
      TOKEN,
      gateRequest({ method: 'POST', url: AUTH_LOGIN_PATH }),
      async () => `token=${TOKEN}`,
    )
    expect(result?.status).toBe(303)
    expect(result?.headers?.location).toBe('/')
    const cookie = result?.headers?.['set-cookie']
    expect(cookie).toContain(`${AUTH_COOKIE_NAME}=${TOKEN}`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
  })

  it('refuses a wrong login POST and shows the form again', async () => {
    const result = await runAuthGate(TOKEN, gateRequest({ method: 'POST', url: AUTH_LOGIN_PATH }), async () => 'token=wrong-token')
    expect(result).toMatchObject({ status: 401 })
    expect(result?.body).toContain('Invalid token.')
  })

  it('accepts the bearer token for automation clients', async () => {
    const result = await runAuthGate(TOKEN, gateRequest({ headers: headers({ authorization: `Bearer ${TOKEN}` }) }), async () => '')
    expect(result).toBeUndefined()
    const refused = await runAuthGate(TOKEN, gateRequest({ headers: headers({ authorization: 'Bearer wrong-token' }) }), async () => '')
    expect(refused).toMatchObject({ status: 401 })
  })

  it('accepts the cookie among unrelated cookies', async () => {
    const result = await runAuthGate(TOKEN, gateRequest({
      headers: headers({ cookie: `other=1; ${AUTH_COOKIE_NAME}=${TOKEN}` }),
    }), async () => '')
    expect(result).toBeUndefined()
    const refused = await runAuthGate(TOKEN, gateRequest({
      headers: headers({ cookie: `${AUTH_COOKIE_NAME}=wrong-token` }),
    }), async () => '')
    expect(refused).toMatchObject({ status: 401 })
  })

  it('never reads the body except for the login POST', async () => {
    const refused = await runAuthGate(TOKEN, gateRequest(), async () => { throw new Error('body must not be read') })
    expect(refused).toMatchObject({ status: 401 })
  })

  it('classifies loopback remote addresses', () => {
    expect(isLoopbackRemote('127.0.0.1')).toBe(true)
    expect(isLoopbackRemote('::1')).toBe(true)
    expect(isLoopbackRemote('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackRemote('10.0.0.5')).toBe(false)
    expect(isLoopbackRemote(undefined)).toBe(false)
  })

  it('reads bounded login bodies and rejects oversized ones', async () => {
    const small = Readable.from(['token=', TOKEN]) as unknown as IncomingMessage
    await expect(readRequestBody(small)).resolves.toBe(`token=${TOKEN}`)
    const large = Readable.from(['x'.repeat(MAX_LOGIN_BODY_BYTES + 1)]) as unknown as IncomingMessage
    await expect(readRequestBody(large)).rejects.toThrow(/exceeds/)
  })

  it('validates the token alphabet and bounds at the schema', () => {
    expect(HttpServer.Config({ host: '127.0.0.1', port: 0 })).toMatchObject({ host: '127.0.0.1', port: 0 })
    expect(HttpServer.Config({ host: '127.0.0.1', port: 0, authToken: TOKEN })).toMatchObject({ authToken: TOKEN })
    expect(() => HttpServer.Config({ host: '127.0.0.1', port: 0, authToken: 'short' })).toThrow(/authToken/)
    expect(() => HttpServer.Config({ host: '127.0.0.1', port: 0, authToken: 'bad token!' })).toThrow(/authToken/)
  })
})

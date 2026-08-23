/**
 * Optional non-loopback authentication gate for the HTTP carrier. When a
 * deployment names an `authToken`, requests whose socket arrives from a
 * non-loopback address must authenticate with one of two proofs: the
 * HttpOnly cookie minted by the `/login` form, or an
 * `Authorization: Bearer <token>` header for non-browser clients. Requests
 * from loopback sockets always pass, so local use keeps the default open
 * posture. The gate is reachability-flavored authentication, not TLS: over
 * plain HTTP the token and cookie travel unencrypted.
 */

import { timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'

/** The login route the gate owns. Loopback clients never see it. */
export const AUTH_LOGIN_PATH = '/login'
/** The authentication cookie name. */
export const AUTH_COOKIE_NAME = 'dsh_web_auth'
/** Largest accepted login form body: the single token field plus form overhead. */
export const MAX_LOGIN_BODY_BYTES = 4096

/** The request facts the gate reads, independent of the HTTP representation. */
export interface AuthGateRequest {
  headers: IncomingHttpHeaders
  method?: string | undefined
  url?: string | undefined
  remoteAddress?: string | undefined
}

/** What the caller writes when the gate refuses or handles a login exchange. */
export interface AuthGateResult {
  status: number
  headers?: Record<string, string>
  body: string
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/**
 * Whether a socket address is loopback. IPv4-mapped IPv6 loopback addresses
 * are normalized to their IPv4 form; an absent address is treated as remote
 * so tests and unusual sockets fail closed when a token is configured.
 */
export function isLoopbackRemote(remoteAddress: string | undefined): boolean {
  if (remoteAddress === undefined) return false
  const normalized = remoteAddress.toLowerCase().startsWith('::ffff:')
    ? remoteAddress.slice('::ffff:'.length)
    : remoteAddress
  return normalized === '127.0.0.1' || normalized === '::1'
}

/** Constant-time token comparison; unequal lengths never compare. */
function tokenMatches(candidate: string, token: string): boolean {
  if (candidate.length !== token.length) return false
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(token))
}

/** The bearer token from an `Authorization: Bearer <token>` header, if any. */
function bearerToken(headers: IncomingHttpHeaders): string | undefined {
  const authorization = header(headers, 'authorization')
  if (authorization === undefined || !authorization.startsWith('Bearer ')) return undefined
  return authorization.slice('Bearer '.length)
}

/** The value of the gate's cookie, when the request carries one. */
function gateCookie(headers: IncomingHttpHeaders): string | undefined {
  const cookie = header(headers, 'cookie')
  if (cookie === undefined) return undefined
  for (const part of cookie.split(';')) {
    const equals = part.indexOf('=')
    if (equals === -1) continue
    if (part.slice(0, equals).trim() === AUTH_COOKIE_NAME) return part.slice(equals + 1).trim()
  }
  return undefined
}

/** The pathname of a request URL, undefined when unparsable. */
function pathnameOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined
  try {
    return new URL(url, 'http://x').pathname
  } catch {
    return undefined
  }
}

/** Whether the request advertises a document destination, versus an asset or API read. */
function acceptsHtml(headers: IncomingHttpHeaders): boolean {
  return (header(headers, 'accept') ?? '').includes('text/html')
}

/** The self-contained login page; no external assets, no user-controlled markup. */
function loginPage(message?: string): string {
  return [
    '<!doctype html>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>dsh web</title>',
    '<style>body{font:14px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#111;color:#eee}form{display:grid;gap:.6rem;min-width:16rem}input{padding:.45rem;border:1px solid #444;border-radius:4px;background:#1d1d1d;color:#eee}button{padding:.45rem;border:0;border-radius:4px;background:#3b82f6;color:white}</style>',
    '<form method="post" action="/login">',
    '<label for="token">Access token</label>',
    '<input id="token" name="token" type="password" autofocus autocomplete="current-password">',
    '<button type="submit">Sign in</button>',
    message === undefined ? '' : `<p>${message}</p>`,
    '</form>',
    '</html>',
  ].join('\n')
}

/** The submitted token from a urlencoded form body, when present. */
function submittedToken(body: string): string | undefined {
  const parsed = new URLSearchParams(body)
  return parsed.get('token') ?? undefined
}

/**
 * Read a bounded request body for the login form. Oversized bodies reject so
 * a hostile client cannot make the gate buffer unbounded input.
 */
export function readRequestBody(req: IncomingMessage, maxBytes = MAX_LOGIN_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    req.on('data', (chunk: Buffer | string) => {
      if (settled) return
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      size += buffer.length
      if (size > maxBytes) {
        fail(new Error(`request body exceeds ${String(maxBytes)} bytes`))
        return
      }
      chunks.push(buffer)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', fail)
  })
}

/**
 * Decide one request against the gate. `undefined` means pass; otherwise the
 * caller writes the returned response verbatim. `readBody` runs only for the
 * login POST, so ordinary traffic pays no body buffering.
 */
export async function runAuthGate(
  token: string | undefined,
  request: AuthGateRequest,
  readBody: () => Promise<string>,
): Promise<AuthGateResult | undefined> {
  if (token === undefined || isLoopbackRemote(request.remoteAddress)) return undefined
  const pathname = pathnameOf(request.url)
  if (pathname === AUTH_LOGIN_PATH) {
    if (request.method === 'POST') {
      const body = await readBody()
      const submitted = submittedToken(body)
      if (submitted !== undefined && tokenMatches(submitted, token)) {
        return {
          status: 303,
          headers: {
            location: '/',
            'set-cookie': `${AUTH_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict`,
          },
          body: '',
        }
      }
      return {
        status: 401,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        body: loginPage('Invalid token.'),
      }
    }
    return {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      body: loginPage(),
    }
  }
  const bearer = bearerToken(request.headers)
  if (bearer !== undefined && tokenMatches(bearer, token)) return undefined
  const cookie = gateCookie(request.headers)
  if (cookie !== undefined && tokenMatches(cookie, token)) return undefined
  if (request.method === 'GET' && acceptsHtml(request.headers)) {
    return {
      status: 302,
      headers: { location: AUTH_LOGIN_PATH, 'cache-control': 'no-store' },
      body: '',
    }
  }
  return {
    status: 401,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    body: 'unauthorized',
  }
}

#!/usr/bin/env node
/**
 * lan-bridge — expose the loopback-only DSH Web GUI to the LAN from this machine.
 *
 * Why a forwarder instead of "--host 0.0.0.0"? The shipped CLI refuses
 * all-interfaces binding on purpose (it would expose remote code execution to
 * the network), and the webserver row only accepts 127.0.0.1 | 0.0.0.0. So the
 * supported shape is: keep the GUI on loopback, forward a LAN-facing port onto
 * it, and let DSH keep authenticating (per-process launch token -> HttpOnly
 * cookie). This bridge never mints, forges or replays a credential.
 *
 * Header translation:
 *
 *   plain (default)
 *     Pass the client's real Host/Origin through. Works when the running GUI
 *     trusts the LAN authority, i.e. it was started with
 *         dsh web --no-open --port 3081 --trusted-host <lan-ip>
 *     or the connection row's trustedHosts was extended through the profile
 *     patch layer. This keeps DSH's DNS-rebinding/cross-site fence fully intact.
 *
 *   --rewrite-host
 *     Translate Host/Origin for the LAN authority back to the loopback
 *     authority, so a GUI started WITHOUT --trusted-host still serves LAN
 *     clients. DSH's Host fence — a DNS-rebinding defense, not an identity
 *     check — is bypassed; a foreign Origin is passed through untouched, so the
 *     cross-site half of that fence still rejects it.
 *
 * Token handling (so nobody types a 43-character token on a phone):
 *
 *   The launch token exists only in the GUI process output, so this bridge can
 *   learn it from a file the launcher tees that output into:
 *       --token-file <path>     poll it and pick up "?token=..." when it appears
 *       --echo-log              also echo those GUI lines here (useful when the
 *                               launcher redirected the GUI's stdout)
 *   Given a token it prints the ready-to-open LAN URL, and with
 *       --auto-login            any unauthenticated *page navigation* is
 *                               answered with a 303 to /?token=<token> instead
 *                               of the GUI's 401, so the browser completes
 *                               DSH's own token exchange by itself.
 *   --auto-login hands a session to every source that can reach this port, so
 *   it refuses to run without a scope: either --allow <ip[,ip|cidr]> or the
 *   explicit --any-source. XHR/fetch/WebSocket 401s are never rewritten.
 *
 * Usage:
 *   node lan-bridge.mjs [--listen <host:port> | --lan-port <n>] [--target <host:port>]
 *                       [--rewrite-host] [--allow <ip,ip,ip/cidr>]
 *                       [--token <launch-token>] [--token-file <path>]
 *                       [--auto-login] [--any-source] [--echo-log] [--quiet]
 *                       [--print-lan-ip]
 *
 * Defaults: --listen <first non-internal IPv4>:<target port> (override the port alone with
 * --lan-port), --target 127.0.0.1:3081. An explicit --listen beats --lan-port.
 */

import http from 'node:http'
import net from 'node:net'
import { readFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'

/** Line terminators, spelled without escape sequences so this file survives tooling. */
const CR = String.fromCharCode(13)
const LF = String.fromCharCode(10)
const CRLF = CR + LF

function fail(message) {
  console.error('lan-bridge: ' + message)
  process.exit(2)
}

function flag(name) {
  return process.argv.includes('--' + name)
}

function value(name, fallback) {
  // Last occurrence wins, so a launcher can pass a default before the user's own flag.
  const at = process.argv.lastIndexOf('--' + name)
  if (at === -1) return fallback
  const next = process.argv[at + 1]
  if (next === undefined || next.startsWith('--')) fail('--' + name + ' needs a value')
  return next
}

function parseAuthority(text, what) {
  const at = text.lastIndexOf(':')
  if (at <= 0) fail(what + ' must be host:port, got ' + JSON.stringify(text))
  const host = text.slice(0, at)
  const port = Number(text.slice(at + 1))
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(what + ' has an invalid port: ' + text)
  return { host, port, text: host + ':' + port }
}

function firstLanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address
    }
  }
  fail('no non-internal IPv4 interface found; pass --listen <host:port>')
}

// Answer the launchers' "which address should I advertise?" question here, so they never
// have to build a quoted node -e program: PowerShell 5.1 strips embedded double quotes
// when it hands an argument to a native exe, which silently breaks such one-liners.
if (flag('print-lan-ip')) {
  console.log(firstLanAddress())
  process.exit(0)
}

// Answer the launchers' other question: does the RUNNING GUI already trust this LAN
// authority? One probe of GET /api with that Host - 403 means the /api trust fence
// rejects it, anything else means the fence let the request through. Prints one word.
if (flag('probe-trust')) {
  const authority = value('probe-trust', '')
  if (authority === '') fail('--probe-trust needs an authority, e.g. 10.0.0.5:3082')
  const probeTarget = parseAuthority(value('target', '127.0.0.1:3081'), '--target')
  const probe = http.request({
    host: probeTarget.host,
    port: probeTarget.port,
    path: '/api',
    method: 'GET',
    headers: { host: authority },
  }, (res) => {
    res.resume()
    console.log(res.statusCode === 403 ? 'untrusted' : 'trusted')
    process.exit(0)
  })
  probe.on('error', () => {
    console.log('unreachable')
    process.exit(0)
  })
  probe.end()
}

const target = parseAuthority(value('target', '127.0.0.1:3081'), '--target')

// Listen authority: an explicit --listen wins, else the LAN address with --lan-port
// (defaulting to the target port, so a bare invocation mirrors the GUI's port).
const listenAuthority = value('listen', '')
const lanPortText = value('lan-port', '')
let listenHost
let listenPort
if (listenAuthority !== '') {
  const explicit = parseAuthority(listenAuthority, '--listen')
  listenHost = explicit.host
  listenPort = explicit.port
} else {
  listenHost = firstLanAddress()
  if (lanPortText === '') {
    listenPort = target.port
  } else {
    listenPort = Number(lanPortText)
    if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
      fail('--lan-port has an invalid port: ' + JSON.stringify(lanPortText))
    }
  }
}
const listen = { host: listenHost, port: listenPort, text: listenHost + ':' + String(listenPort) }
const rewrite = flag('rewrite-host')
const quiet = flag('quiet')
const allow = (value('allow', '') || '').split(',').map(s => s.trim()).filter(Boolean)
const autoLogin = flag('auto-login')
const anySource = flag('any-source')
const echoLog = flag('echo-log')
const tokenFile = value('token-file', '')
let token = value('token', '')
// Accept a whole pasted startup line or URL too, e.g.
//   dsh web: http://127.0.0.1:3081/?token=XXX (LAN: ...)
{
  const pasted = /[?&]token=([A-Za-z0-9_-]{16,})/u.exec(token)
  if (pasted !== null) token = pasted[1]
}

if (autoLogin && allow.length === 0 && !anySource) {
  fail('--auto-login would hand a DSH session to every source that can reach this port: '
    + 'scope it with --allow <ip[,ip|cidr]> (or pass --any-source to accept that on purpose)')
}
if (autoLogin && token === '' && tokenFile === '') {
  fail('--auto-login needs the GUI launch token: pass --token <token> or --token-file <path to the GUI output>')
}

const TARGET_AUTHORITY = target.text
const LOOPBACK_ORIGIN = 'http://' + TARGET_AUTHORITY

/** Dotted-quad IPv4 to an unsigned integer, or undefined for anything else. */
function ipToInt(ip) {
  const parts = ip.split('.')
  if (parts.length !== 4) return undefined
  let result = 0
  for (const part of parts) {
    const octet = Number(part)
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return undefined
    result = result * 256 + octet
  }
  return result
}

/**
 * Whether one client address passes --allow. Entries are exact IPv4 literals or
 * IPv4 CIDR blocks ("10.228.0.0/16"); an empty allowlist admits everyone.
 */
function sourceAllowed(client) {
  const ip = client.replace(/^::ffff:/u, '')
  if (allow.length === 0) return true
  const clientInt = ipToInt(ip)
  for (const entry of allow) {
    if (entry === ip) return true
    const slash = entry.lastIndexOf('/')
    if (slash === -1) continue
    const base = ipToInt(entry.slice(0, slash))
    const bits = Number(entry.slice(slash + 1))
    if (base === undefined || clientInt === undefined) continue
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) continue
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    if (((base & mask) >>> 0) === ((clientInt & mask) >>> 0)) return true
  }
  return false
}

/** Headers a proxy must not forward verbatim; node re-frames the body itself. */
function dropHopByHop(headers) {
  delete headers.connection
  delete headers['proxy-connection']
  delete headers['keep-alive']
  delete headers.upgrade
  delete headers['transfer-encoding']
  return headers
}

/**
 * Translate only a same-origin Origin; a foreign Origin must keep failing the
 * server's cross-site fence rather than being laundered into a trusted one.
 */
function rewriteOrigin(headers, clientHost) {
  const origin = headers.origin
  if (typeof origin !== 'string') return
  try {
    const parsed = new URL(origin)
    const clientAuthority = typeof clientHost === 'string' ? clientHost : ''
    if (parsed.host === clientAuthority || parsed.host === listen.text) headers.origin = LOOPBACK_ORIGIN
  } catch {
    /* malformed Origin: leave it for the server to reject */
  }
}

function rewriteRequestHeaders(headers, clientHost) {
  const out = { ...headers }
  dropHopByHop(out)
  if (!rewrite) return out
  out.host = TARGET_AUTHORITY
  rewriteOrigin(out, clientHost)
  return out
}

/**
 * WebSocket handshakes are the one request shape whose hop-by-hop headers ARE
 * the payload: Connection: Upgrade + Upgrade: websocket + the Sec-WebSocket-*
 * pair must reach the gateway intact, or it answers 426 Upgrade Required and
 * the client retries forever. So this path keeps them and rewrites only the
 * authority.
 */
function rewriteUpgradeHeaders(headers, clientHost) {
  const out = { ...headers }
  delete out['proxy-connection']
  if (!rewrite) return out
  out.host = TARGET_AUTHORITY
  rewriteOrigin(out, clientHost)
  return out
}

function log(...parts) {
  if (!quiet) console.log('lan-bridge:', ...parts)
}

/** Authority a phone should use: the bound address, or this machine's LAN literal. */
function advertisedAuthority() {
  const host = listen.host === '0.0.0.0' ? firstLanAddress() : listen.host
  return host + ':' + String(listen.port)
}

function announceToken() {
  if (token === '') return
  // Always print both forms, and never depend on the log echo for this: the loopback URL is
  // the line the GUI itself printed (reconstructed from the target authority), the LAN URL is
  // the one to open on a phone.
  console.log('lan-bridge: GUI URL  = ' + LOOPBACK_ORIGIN + '/?token=' + token)
  console.log('lan-bridge: LAN URL  = http://' + advertisedAuthority() + '/?token=' + token)
  if (autoLogin) {
    console.log('lan-bridge: auto-login ON - opening the plain URL http://' + advertisedAuthority()
      + '/ in a browser from an allowed source authenticates it automatically')
  }
}

/** A top-level page navigation, as opposed to XHR/fetch/asset traffic. */
function wantsAutoLogin(req) {
  if (!autoLogin || token === '') return false
  if (req.method !== 'GET') return false
  if ((req.url ?? '').includes('token=')) return false
  const accept = req.headers.accept
  return typeof accept === 'string' && accept.includes('text/html')
}

// ---- GUI output watcher: learn the launch token, optionally echo the log ----
let echoedChars = 0

/**
 * Drop control characters (ANSI escapes, stray progress bytes). A CR or ESC in an echoed
 * line would make the console overwrite the 'gui | ' prefix.
 */
function printable(text) {
  let out = ''
  for (const ch of text) {
    if (ch.codePointAt(0) >= 32) out += ch
  }
  return out
}

/** Interesting lines that deserve their own echo line even when the writer glued them on. */
const ECHO_MARKERS = ['dsh web:']

/**
 * Split GUI output into echo lines. CR and LF both end a line, and a marker starts a new one
 * even when the writer glued it to a progress fragment: when stdout is a file, an in-place
 * progress line is not terminated, so 'dsh web: http://...?token=...' arrives glued to it.
 */
function fragments(text) {
  const out = []
  for (const lfPiece of text.split(LF)) {
    for (const crPiece of lfPiece.split(CR)) {
      let rest = crPiece
      for (;;) {
        let next = -1
        for (const marker of ECHO_MARKERS) {
          const at = rest.indexOf(marker)
          if (at > 0 && (next === -1 || at < next)) next = at
        }
        if (next === -1) break
        out.push(rest.slice(0, next))
        rest = rest.slice(next)
      }
      out.push(rest)
    }
  }
  return out
}

function watchTokenFile() {
  if (tokenFile === '') return
  let text
  try {
    text = readFileSync(tokenFile, 'utf8')
  } catch {
    return
  }
  if (echoLog) {
    // Cursor by character, never by piece index: a piece count is off by the trailing empty
    // piece that a final newline produces, so the next real line was silently swallowed -
    // exactly how the 'dsh web: ...?token=...' line went missing when it arrived late.
    if (text.length < echoedChars) echoedChars = 0
    if (text.length > echoedChars) {
      const fresh = text.slice(echoedChars)
      echoedChars = text.length
      for (const piece of fragments(fresh)) {
        const line = printable(piece)
        if (line !== '') console.log('gui | ' + line)
      }
    }
  }
  if (token !== '') return
  const match = /[?&]token=([A-Za-z0-9_-]{16,})/u.exec(text)
  if (match === null) return
  token = match[1]
  announceToken()
}

const server = http.createServer((req, res) => {
  const client = req.socket.remoteAddress ?? '?'
  if (!sourceAllowed(client)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('lan-bridge: source ' + client + ' is not in --allow' + LF)
    return
  }
  const headers = rewriteRequestHeaders(req.headers, req.headers.host)
  const upstream = http.request({
    host: target.host,
    port: target.port,
    method: req.method,
    path: req.url,
    headers,
  }, (up) => {
    if (up.statusCode === 401 && wantsAutoLogin(req)) {
      log(req.method, req.url, '-> 401 from the GUI, answering 303 to the token URL')
      up.resume()
      res.writeHead(303, { location: '/?token=' + token, 'cache-control': 'no-store' })
      res.end('lan-bridge: completing the DSH token exchange' + LF)
      return
    }
    log(req.method, req.url, '->', up.statusCode, rewrite ? '(host rewritten)' : '')
    const out = { ...up.headers }
    delete out['transfer-encoding']
    res.writeHead(up.statusCode ?? 502, up.statusMessage, out)
    up.pipe(res)
  })
  upstream.on('error', (error) => {
    log(req.method, req.url, '-> upstream failed:', error.code ?? error.message)
    if (res.headersSent) {
      res.destroy()
      return
    }
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('lan-bridge: cannot reach ' + TARGET_AUTHORITY + ' (' + (error.code ?? error.message) + ')' + LF
      + 'is the DSH Web GUI running?' + LF)
  })
  req.pipe(upstream)
})

// WebSocket (/api/remote.mux) and any other upgrade: same header translation,
// then a raw byte pipe in both directions.
server.on('upgrade', (req, socket, head) => {
  const client = req.socket.remoteAddress ?? '?'
  if (!sourceAllowed(client)) {
    socket.destroy()
    return
  }
  const headers = rewriteUpgradeHeaders(req.headers, req.headers.host)
  const lines = [req.method + ' ' + req.url + ' HTTP/1.1']
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) for (const item of value) lines.push(name + ': ' + item)
    else if (value !== undefined) lines.push(name + ': ' + value)
  }
  const upstream = net.connect(target.port, target.host, () => {
    log('upgrade', req.url, '-> tunneled', rewrite ? '(host rewritten)' : '')
    upstream.write(lines.join(CRLF) + CRLF + CRLF)
    if (head.length > 0) upstream.write(head)
    socket.pipe(upstream).pipe(socket)
  })
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
})

server.on('clientError', (error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request' + CRLF + CRLF)
  log('client error:', error.code ?? error.message)
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    fail(listen.text + ' is already in use - pick another port with --listen <host:port>')
  }
  fail(error.code ?? error.message)
})

// --probe-trust answers a one-shot question; it must not open a listener.
if (!flag('probe-trust')) server.listen(listen.port, listen.host, () => {
  console.log('lan-bridge: http://' + listen.text + '  ->  http://' + TARGET_AUTHORITY
    + (rewrite ? '   [rewrite-host: ON - DSH Host fence bypassed, token auth still required]' : '   [plain: the GUI must trust ' + listen.host + ']'))
  if (allow.length > 0) console.log('lan-bridge: source allowlist:', allow.join(', '))
  if (autoLogin && anySource) {
    console.log('lan-bridge: !! auto-login is open to ANY source (--any-source): every client that can reach '
      + listen.text + ' gets a DSH session')
  }
  if (token !== '') announceToken()
  else if (tokenFile !== '') console.log('lan-bridge: waiting for the launch token in ' + tokenFile)
  else {
    console.log('lan-bridge: no --token-file here, so the "gui | dsh web: ..." echo stays off and the launch')
    console.log('            token is unknown; pass --token-file <path to the GUI output> to echo it and read the token')
  }
  watchTokenFile()
})

if (tokenFile !== '') {
  const timer = setInterval(watchTokenFile, 500)
  timer.unref()
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log('stopping')
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 500).unref()
  })
}

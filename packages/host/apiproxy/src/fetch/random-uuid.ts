/**
 * Secure-context-independent UUID v4 minting for client-side wire correlation.
 *
 * `crypto.randomUUID()` exists only in secure contexts (https, localhost), so a
 * phone reaching the server over `http://<LAN-IP>:<port>` has a `crypto` object
 * without that method. `crypto.getRandomValues()` is available on insecure
 * origins too, so the fallback formats its bytes into the same RFC 4122 v4 shape.
 */

export function randomUuid(): string {
  const random = globalThis.crypto
  if (typeof random.randomUUID === 'function') {
    try {
      return random.randomUUID()
    } catch {
      // Some engines define but refuse the method on insecure origins.
    }
  }
  const bytes = random.getRandomValues(new Uint8Array(16))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  view.setUint8(6, (view.getUint8(6) & 0x0f) | 0x40)
  view.setUint8(8, (view.getUint8(8) & 0x3f) | 0x80)
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

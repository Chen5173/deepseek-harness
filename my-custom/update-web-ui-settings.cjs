#!/usr/bin/env node
// Refresh the remote-web-ui section of the container's settings.yaml so the
// public tunnel origin is trusted by the /api/pair/* routes and remote devices
// do not get the "device not paired" fence:
//   - publicBaseUrl       = current trycloudflare URL (from start.sh)
//   - requirePairingForLan = defaults to false (no device pairing needed; the
//     tunnel origin is already SDK-trusted via DSH_TRUSTED_HOST and gated by
//     DSH_WEB_AUTH_TOKEN). An explicit true in the file is respected.
// Usage:
//   node update-web-ui-settings.cjs <settings.yaml> <publicUrl> <repoRoot>
const fs = require('node:fs');
const path = require('node:path');

const file = process.argv[2];
const publicUrl = process.argv[3] || '';
const repoRoot = process.argv[4];

let yaml;
try {
  yaml = require(path.join(repoRoot, 'node_modules', 'js-yaml'));
} catch (error) {
  console.error('[settings] js-yaml not found under repo node_modules: ' + error.message);
  process.exit(1);
}

let doc = {};
if (fs.existsSync(file)) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (raw) {
    try {
      const parsed = yaml.load(raw);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) doc = parsed;
    } catch {
      // Unparsable file: treat as empty and rewrite with only our section.
      doc = {};
    }
  }
}

doc['remote-web-ui'] = doc['remote-web-ui'] ?? {};
const section = doc['remote-web-ui'];
if (publicUrl) section.publicBaseUrl = publicUrl;
if (section.requirePairingForLan === undefined) section.requirePairingForLan = false;
// The host profile enables autoTunnel (it manages its own tunnel). In the
// container the tunnel is the separate cloudflared service, so autoTunnel must
// stay OFF or the plugin ignores the manually configured publicBaseUrl and the
// /api/pair/* fence drops the public origin again.
section.autoTunnel = false;

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, yaml.dump(doc));
console.log(
  '[settings] remote-web-ui.publicBaseUrl=' + (section.publicBaseUrl || '(none)')
  + ' requirePairingForLan=' + String(section.requirePairingForLan),
);

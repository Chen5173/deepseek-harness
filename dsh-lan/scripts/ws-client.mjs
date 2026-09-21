import net from 'node:net'
const [host, port] = (process.argv[2] ?? '127.0.0.1:3099').split(':')
const socket = net.connect(Number(port), host, () => {
  socket.write(['GET /api/remote.mux HTTP/1.1', 'Host: ' + host + ':' + port, 'Upgrade: websocket',
    'Connection: Upgrade', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    'Origin: http://' + host + ':' + port, '', ''].join('\r\n'))
})
let buf = ''
socket.setTimeout(4000, () => { console.log('CLIENT: timed out (no handshake response)'); socket.destroy(); process.exit(0) })
socket.on('data', (d) => { buf += d.toString('latin1'); if (buf.includes('\r\n\r\n')) { console.log('CLIENT: ' + buf.split('\r\n')[0]); socket.destroy(); process.exit(0) } })
socket.on('error', (e) => { console.log('CLIENT: error ' + e.code); process.exit(0) })
socket.on('close', () => { console.log('CLIENT: socket closed; response was ' + JSON.stringify(buf.split('\r\n')[0] ?? '')); process.exit(0) })
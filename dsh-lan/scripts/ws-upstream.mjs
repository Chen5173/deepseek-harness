import http from 'node:http'
const port = Number(process.argv[2] ?? 3098)
const server = http.createServer((req, res) => {
  console.log('UPSTREAM plain-HTTP  url=' + req.url + ' host=' + (req.headers.host ?? '-')
    + ' connection=' + (req.headers.connection ?? '-') + ' upgrade=' + (req.headers.upgrade ?? '-'))
  res.writeHead(426, { 'content-type': 'text/plain' }); res.end('upgrade required\n')
})
server.on('upgrade', (req, socket) => {
  console.log('UPSTREAM upgrade  url=' + req.url + ' host=' + (req.headers.host ?? '-')
    + ' connection=' + (req.headers.connection ?? '-') + ' upgrade=' + (req.headers.upgrade ?? '-')
    + ' origin=' + (req.headers.origin ?? '-') + ' key=' + (req.headers['sec-websocket-key'] ?? '-'))
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
  setTimeout(() => socket.end(), 150)
})
server.listen(port, '127.0.0.1', () => console.log('mock upstream listening on 127.0.0.1:' + port))
'use strict';

var net = require('net');
var server = net.createServer(function (conn) {
  function echo(chunk) {
    conn.write(chunk);
    if (chunk.length <= 10 && /\b(q|quit|end|cancel)\b/i.test(chunk.toString('utf8'))) {
      conn.end();
      conn.removeListener('data', echo);
    }
  }
  conn.on('data', echo);
  // NOTE: early versions of telebit do not support a 'connection' event
  // and therefore will say hello after the first message from the client
  conn.write(
    "[Echo Server] Hello! I'm an echo server.\n"
  + "[Echo Server] I try to be your friend but when I see things like q|quit|end|cancel, I give up.\n"
  );
});
server.on('error', function (err) {
  console.error("[echo server]");
  console.error(err);
});
server.listen(process.argv[2] || 3000, function () {
  console.info("Listening on", this.address());
  console.info('ctrl+c to cancel');
});

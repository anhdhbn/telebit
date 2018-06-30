'use strict';

module.exports = function (opts) {
  console.log("Could not connect");
  var socket = opts.socket;
  var handler = opts.handler;
  var http = require('http');
  var server = http.createServer(function (req, res) {
    console.log('responding to thing');
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/html');
    res.end("<html>"
      + "<head><title>Couldn't Connect</title></head>"
      + "<body>Could not connect to localhost:" + handler + "</body>"
    + "</html>");
  });
  //server.emit('connection', socket);
  socket.end("Could not connect to localhost:" + handler);
};

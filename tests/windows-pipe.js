'use strict';

var os = require('os');
var net = require('net');
var ipc = {
  path: /^win/.test(os.platform()) ? '\\\\.\\pipe\\X:/name/of/pipe' : (__dirname + '/tmp.sock')
};
var oldUmask = process.umask(0x0000);
var server = net.createServer();

server.listen({
  path: ipc.path || null
, host: 'localhost'
, port: ipc.port || null
, writeableAll: true
, readableAll: true
}, function () {
  process.umask(oldUmask);
  console.log("Listening on", this.address());
});

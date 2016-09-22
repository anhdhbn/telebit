'use strict';

var sni = require('sni');
var machine = require('./machine.js');
var hello = require('fs').readFileSync('./sni.hello.bin');
var version = 1;
var header = 'IPv4,127.0.0.1,443,' + hello.byteLength;
var buf = Buffer.concat([
  Buffer.from([ 255 - version, header.length ])
, Buffer.from(header)
, hello
]);

console.log('sni(hello):', sni(hello));
console.log('hello.byteLength:', hello.byteLength);

var services = { 'ssh': 22, 'http': 4080, 'https': 8443 };
//var clients = {};

machine.onMessage = function (opts) {
  var id = opts.family + ',' + opts.address + ',' + opts.port;
  var service = 'https';
  var port = services[service];

  /*
  if (clients[id]) {
    clients[id].write(opts.data);
    return;
  }
  */

  var servername = sni(opts.data);

  console.log('');
  console.log('');
  console.log('[onMessage]');
  console.log('equal:', opts.data.equals(hello));
  console.log('byteLength:', opts.data.byteLength);
  console.log('port:', port);
  if (!servername) {
    console.warn("no servername found for '" + id + "'");
    return;
  }

  console.log("servername: '" + servername + "'");
};

// full message in one go
machine.fns.addChunk(buf);
console.log('');
console.log('');

// messages one byte at a time
buf.forEach(function (byte) {
  machine.fns.addChunk(Buffer.from([ byte ]));
});

'use strict';

var net = require('net');
var jwt = require('jsonwebtoken');
var sni = require('sni');
// TODO ask oauth3.org where to connect
// TODO reconnect on disconnect

function pack(address, data) {
  var version = 1;
  var header = /*servername + ',' +*/address.family + ',' + address.address + ',' + address.port + ',' + data.byteLength;
  var meta = [ 255 - version, header.length ];
  var buf = Buffer.alloc(meta.length + header.length + data.byteLength);

  buf.write(meta[0], 0);
  buf.write(meta[1], 1);
  buf.write(header, 2);
  buf.write(data, 2 + header.length);

  return buf;
}

// Assumption: will not get next tcp packet unless previous packet succeeded
//var services = { 'ssh': 22, 'http': 80, 'https': 443 };
var services = { 'ssh': 22, 'http': 4080, 'https': 8443 };
var tunneler = net.connect({ port: 5443 , host: 'pokemap.hellabit.com' }, function () {
  var token = jwt.sign({ name: 'pokemap.hellabit.com' }, 'shhhhh');
  var clients = {};

  tunneler.write(token);

  // BaaS / Backendless / noBackend / horizon.io
  // user authentication
  // a place to store data
  // file management
  // Synergy Teamwork Paradigm = Jabberwocky
  var machine = require('./machine.js').create();
  machine.onMessage = function (opts) {
    var id = opts.family + ',' + opts.address + ',' + opts.port;
    var service = 'https';
    var port = services[service];
    var client;

    if (clients[id]) {
      clients[id].write(opts.data);
      return;
    }

    var servername = sni(opts.data);

    if (!servername) {
      console.warn("no servername found for '" + id + "'");
      tunneler.write(pack(opts, '|__ERROR__|'));
      return;
    }

    console.log("servername: '" + servername + "'");

    clients = clients[id] = net.createConnect({ port: port, host: servername }, function () {
      client.on('data', function (chunk) {
        console.error('client Data');
        tunneler.write(pack(opts, chunk));
      });
      client.on('error', function (err) {
        console.error('client Error');
        console.error(err);
        tunneler.write(pack(opts, '|__ERROR__|'));
      });
      client.on('end', function () {
        console.error('client End');
        tunneler.write(pack(opts, '|__END__|'));
      });

      client.write(opts.data);
    });
  };

  tunneler.on('data', machine.fns.addChunk);

  tunneler.on('end', function () {
    console.log('end');
  });
});

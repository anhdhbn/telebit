'use strict';

var net = require('net');
var jwt = require('jsonwebtoken');
var sni = require('sni');
// TODO ask oauth3.org where to connect
// TODO reconnect on disconnect

// Assumption: will not get next tcp packet unless previous packet succeeded
//var services = { 'ssh': 22, 'http': 80, 'https': 443 };
var services = { 'ssh': 22, 'http': 4080, 'https': 8443 };
var hostname = 'aj.daplie.me'; // 'pokemap.hellabit.com'

function addrToId(address) {
  return address.family + ',' + address.address + ',' + address.port;
}

/*
function socketToAddr(socket) {
  return { family: socket.remoteFamily, address: socket.remoteAddress, port: socket.remotePort };
}

function socketToId(socket) {
  return addrToId(socketToAddr(socket));
}
*/

var tunneler = net.connect({ port: 5443 , host: hostname }, function () {
  var token = jwt.sign({ name: hostname }, 'shhhhh');
  var localclients = {};

  setInterval(function () {
    console.log('');
    console.log('localclients.length:', Object.keys(localclients).length);
    console.log('');
  }, 5000);

  tunneler.write(token);

  // BaaS / Backendless / noBackend / horizon.io
  // user authentication
  // a place to store data
  // file management
  // Synergy Teamwork Paradigm = Jabberwocky
  var pack = require('tunnel-packer').pack;

  function onMessage(opts) {
    var id = addrToId(opts);
    var service = 'https';
    var port = services[service];
    var lclient;

    if (opts.data.byteLength < 20) {
      if ('|__ERROR__|' === opts.data.toString('utf8')
        || '|__END__|' === opts.data.toString('utf8')) {

        console.log("end '" + opts.address + "'");
        if (localclients[id]) {
          localclients[id].end();
          delete localclients[id];
        }
        return;
      }
    }

    if (localclients[id]) {
      console.log("received data from '" + opts.address + "'", opts.data.byteLength);
      localclients[id].write(opts.data);
      return;
    }

    var servername = sni(opts.data);

    if (!servername) {
      console.warn("no servername found for '" + id + "'");
      tunneler.write(pack(opts, Buffer.from('|__ERROR__|')));
      return;
    }

    console.log("servername: '" + servername + "'");

    lclient = localclients[id] = net.createConnection({ port: port, host: '127.0.0.1' }, function () {

      lclient.on('data', function (chunk) {
        console.log("client '" + opts.address + "' sent ", chunk.byteLength, "bytes");
        tunneler.write(pack(opts, chunk));
      });
      lclient.on('error', function (err) {
        console.error('client Error');
        console.error(err);
        delete localclients[id];
        tunneler.write(pack(opts, Buffer.from('|__ERROR__|')));
      });
      lclient.on('end', function () {
        console.log('client End');
        delete localclients[id];
        tunneler.write(pack(opts, Buffer.from('|__END__|')));
      });

      console.log('received data', opts.data.byteLength);
      lclient.write(opts.data);
    });
  }

  var machine = require('tunnel-packer').create({ onMessage: onMessage });

  tunneler.on('data', machine.fns.addChunk);

  tunneler.on('end', function () {
    console.log('end');
  });
});

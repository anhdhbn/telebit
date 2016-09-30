(function () {
'use strict';

var net = require('net');
var WebSocket = require('ws');
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

var token = jwt.sign({ name: hostname }, 'shhhhh');

/*
var request = require('request');
request.get('https://pokemap.hellabit.com:3000?access_token=' + token, { rejectUnauthorized: false }, function (err, resp) {
  console.log('resp.body');
  console.log(resp.body);
});

return;
//*/

  var tunnelUrl = 'wss://pokemap.hellabit.com:3000/?access_token=' + token;
  var wstunneler;

  function run() {
    var retry = true;
    var localclients = {};
    wstunneler = new WebSocket(tunnelUrl, { rejectUnauthorized: false });

    function onOpen() {
      console.log('[open] tunneler connected');

      /*
      setInterval(function () {
        console.log('');
        console.log('localclients.length:', Object.keys(localclients).length);
        console.log('');
      }, 5000);
      */

      //wstunneler.send(token);

      // BaaS / Backendless / noBackend / horizon.io
      // user authentication
      // a place to store data
      // file management
      // Synergy Teamwork Paradigm = Jabberwocky
      var pack = require('tunnel-packer').pack;
      var handlers = {
        onmessage: function (opts) {
          var cid = addrToId(opts);
          console.log('[wsclient] onMessage:', cid);
          var service = opts.service;
          var port = services[service];
          var lclient;
          var servername;
          var str;
          var m;

          if (opts.data.byteLength < 20) {
            if ('|__ERROR__|' === opts.data.toString('ascii')) {
              handlers.onerror(opts);
              return;
            }
            else if ('|__END__|' === opts.data.toString('ascii')) {
              handlers.onend(opts);
              return;
            }
          }

          function endWithError() {
            wstunneler.send(pack(opts, Buffer.from('|__ERROR__|'), 'error'), { binary: true });
          }

          if (localclients[cid]) {
            console.log("[=>] received data from '" + cid + "' =>", opts.data.byteLength);
            localclients[cid].write(opts.data);
            return;
          }
          else if ('http' === service) {
            str = opts.data.toString();
            m = str.match(/(?:^|[\r\n])Host: ([^\r\n]+)[\r\n]*/im);
            servername = (m && m[1].toLowerCase() || '').split(':')[0];
          }
          else if ('https' === service) {
            servername = sni(opts.data);
          }
          else {
            endWithError();
            return;
          }

          if (!servername) {
            console.warn("|__ERROR__| no servername found for '" + cid + "'");
            console.warn(opts.data.toString());
            wstunneler.send(pack(opts, Buffer.from('|__ERROR__|'), 'error'), { binary: true });
            return;
          }

          console.log("servername: '" + servername + "'");

          lclient = localclients[cid] = net.createConnection({ port: port, host: '127.0.0.1' }, function () {
            console.log("[=>] first packet from tunneler to '" + cid + "' as '" + opts.service + "'", opts.data.byteLength);
            lclient.write(opts.data);
          });
          lclient.on('data', function (chunk) {
            console.log("[<=] local '" + opts.service + "' sent to '" + cid + "' <= ", chunk.byteLength, "bytes");
            console.log(JSON.stringify(chunk.toString()));
            wstunneler.send(pack(opts, chunk), { binary: true });
          });
          lclient.on('error', function (err) {
            console.error("[error] local '" + opts.service + "' '" + cid + "'");
            console.error(err);
            delete localclients[cid];
            wstunneler.send(pack(opts, Buffer.from('|__ERROR__|'), 'error'), { binary: true });
          });
          lclient.on('end', function () {
            console.log("[end] local '" + opts.service + "' '" + cid + "'");
            delete localclients[cid];
            wstunneler.send(pack(opts, Buffer.from('|__END__|'), 'end'), { binary: true });
          });
        }
      , onend: function (opts) {
          var cid = addrToId(opts);
          console.log("[end] '" + cid + "'");
          handlers._onend(cid, opts);
        }
      , onerror: function (opts) {
          var cid = addrToId(opts);
          console.log("[error] '" + cid + "'", opts.code || '', opts.message);
          handlers._onend(cid);
        }
      , _onend: function (cid) {
          if (localclients[cid]) {
            localclients[cid].end();
          }
          delete localclients[cid];
        }
      };
      var machine = require('tunnel-packer').create(handlers);

      wstunneler.on('message', machine.fns.addChunk);
    }

    wstunneler.on('open', onOpen);

    wstunneler.on('close', function () {
      console.log('closing tunnel...');
      process.removeListener('exit', onExit);
      Object.keys(localclients).forEach(function (cid) {
        try {
          localclients[cid].end();
        } catch(e) {
          // ignore
        }

        delete localclients[cid];
      });

      if (retry) {
        console.log('retry on close');
        setTimeout(run, 5000);
      }
    });

    wstunneler.on('error', function (err) {
      console.error("[error] will retry on 'close'");
      console.error(err);
    });

    function onExit() {
      retry = false;
      console.log('on exit...');
      try {
        wstunneler.close();
      } catch(e) {
        console.error(e);
        // ignore
      }
    }

    process.on('exit', onExit);
    process.on('SIGINT', onExit);
  }

  run();
}());

(function () {
'use strict';

var net = require('net');
var WebSocket = require('ws');
var sni = require('sni');
var pack = require('tunnel-packer').pack;
var authenticated = false;

// TODO move these helpers to tunnel-packer package
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


/*
var request = require('request');
request.get('https://pokemap.hellabit.com:3000?access_token=' + token, { rejectUnauthorized: false }, function (err, resp) {
  console.log('resp.body');
  console.log(resp.body);
});

return;
//*/

function run(copts) {
  var services = copts.services; // TODO pair with hostname / sni
  var token = copts.token;
  var tunnelUrl = copts.stunneld + '/?access_token=' + token;
  var wstunneler;
  var retry = true;
  var localclients = {};
  // BaaS / Backendless / noBackend / horizon.io
  // user authentication
  // a place to store data
  // file management
  // Synergy Teamwork Paradigm = Jabberwocky
  var handlers = {
    onmessage: function (opts) {
      var cid = addrToId(opts);
      var service = opts.service;
      var port = services[service];
      var servername;
      var str;
      var m;

      authenticated = true;

      if (localclients[cid]) {
        //console.log("[=>] received data from '" + cid + "' =>", opts.data.byteLength);
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
        handlers._onLocalError(cid, opts, new Error("unsupported service '" + service + "'"));
        return;
      }

      if (!servername) {
        console.info("[error] missing servername for '" + cid + "'", opts.data.byteLength);
        //console.warn(opts.data.toString());
        wstunneler.send(pack(opts, null, 'error'), { binary: true });
        return;
      }

      console.info("[connect] new client '" + cid + "' for '" + servername + "' (" + (handlers._numClients() + 1) + " clients)");

      localclients[cid] = net.createConnection({ port: port, host: '127.0.0.1' }, function () {
        //console.log("[=>] first packet from tunneler to '" + cid + "' as '" + opts.service + "'", opts.data.byteLength);
        localclients[cid].write(opts.data);
      });
      localclients[cid].on('data', function (chunk) {
        //console.log("[<=] local '" + opts.service + "' sent to '" + cid + "' <= ", chunk.byteLength, "bytes");
        //console.log(JSON.stringify(chunk.toString()));
        wstunneler.send(pack(opts, chunk), { binary: true });
      });
      localclients[cid].on('error', function (err) {
        handlers._onLocalError(cid, opts, err);
      });
      localclients[cid].on('end', function () {
        console.info("[end] closing client '" + cid + "' for '" + servername + "' (" + (handlers._numClients() - 1) + " clients)");
        handlers._onLocalClose(cid, opts);
      });
    }
  , onend: function (opts) {
      var cid = addrToId(opts);
      //console.log("[end] '" + cid + "'");
      handlers._onend(cid);
    }
  , onerror: function (opts) {
      var cid = addrToId(opts);
      //console.log("[error] '" + cid + "'", opts.code || '', opts.message);
      handlers._onend(cid);
    }
  , _onend: function (cid) {
      if (localclients[cid]) {
        try {
          localclients[cid].end();
        } catch(e) {
          // ignore
        }
      }
      delete localclients[cid];
    }
  , _onLocalClose: function (cid, opts, err) {
      try {
        wstunneler.send(pack(opts, null, err && 'error' || 'end'), { binary: true });
      } catch(e) {
        // ignore
      }
      delete localclients[cid];
    }
  , _onLocalError: function (cid, opts, err) {
      console.info("[error] closing '" + cid + "' because '" + err.message + "' (" + (handlers._numClients() - 1) + " clients)");
      handlers._onLocalClose(cid, opts, err);
    }
  , _numClients: function () {
      return Object.keys(localclients).length;
    }
  };

  var wsHandlers = {
    onOpen: function () {
      console.info("[open] connected to '" + copts.stunneld + "'");

      var machine = require('tunnel-packer').create(handlers);
      wstunneler.on('message', machine.fns.addChunk);
    }

  , onClose: function () {
      if (!authenticated) {
        console.info('[close] failed on first attempt... check authentication.');
      }
      else if (retry) {
        console.info('[retry] disconnected and waiting...');
        setTimeout(run, 5000, copts);
      }
      else {
        console.info('[close] closing tunnel to exit...');
      }

      process.removeListener('exit', wsHandlers.onExit);
      process.removeListener('SIGINT', wsHandlers.onExit);
      Object.keys(localclients).forEach(function (cid) {
        try {
          localclients[cid].end();
        } catch(e) {
          // ignore
        }
        delete localclients[cid];
      });
    }

  , onError: function (err) {
      console.error("[tunnel error] " + err.message);
      console.error(err);
    }

  , onExit: function () {
      retry = false;
      try {
        wstunneler.close();
      } catch(e) {
        console.error("[error] wstunneler.close()");
        console.error(e);
        // ignore
      }
    }
  };

  console.info("[connect] '" + copts.stunneld + "'");

  wstunneler = new WebSocket(tunnelUrl, { rejectUnauthorized: !copts.insecure });
  wstunneler.on('open', wsHandlers.onOpen);
  wstunneler.on('close', wsHandlers.onClose);
  wstunneler.on('error', wsHandlers.onError);
  process.on('exit', wsHandlers.onExit);
  process.on('SIGINT', wsHandlers.onExit);
}

module.exports.connect = run;

}());

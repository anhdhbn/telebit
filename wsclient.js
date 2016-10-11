(function () {
'use strict';

var WebSocket = require('ws');
var sni = require('sni');
var Packer = require('tunnel-packer');
var authenticated = false;

function run(copts) {
  // TODO pair with hostname / sni
  copts.services = {};
  copts.locals.forEach(function (proxy) {
    //program.services = { 'ssh': 22, 'http': 80, 'https': 443 };
    copts.services[proxy.protocol] = proxy.port;
  });

  var tunnelUrl = copts.stunneld.replace(/\/$/, '') + '/?access_token=' + copts.token;
  var wstunneler;
  var localclients = {};
  // BaaS / Backendless / noBackend / horizon.io
  // user authentication
  // a place to store data
  // file management
  // Synergy Teamwork Paradigm = Jabberwocky
  var handlers = {
    onmessage: function (opts) {
      var net = copts.net || require('net');
      var cid = Packer.addrToId(opts);
      var service = opts.service;
      var port = copts.services[service];
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
        wstunneler.send(Packer.pack(opts, null, 'error'), { binary: true });
        return;
      }

      console.info("[connect] new client '" + cid + "' for '" + servername + "' (" + (handlers._numClients() + 1) + " clients)");

      console.log('port', port, opts.port, service, copts.services);
      localclients[cid] = net.createConnection({
        port: port
      , host: '127.0.0.1'

      , servername: servername
      , data: opts.data
      , remoteFamily: opts.family
      , remoteAddress: opts.address
      , remotePort: opts.port
      }, function () {
        //console.log("[=>] first packet from tunneler to '" + cid + "' as '" + opts.service + "'", opts.data.byteLength);
        //localclients[cid].write(opts.data);
        //localclients[cid].resume();
      });
      // 'data'
      localclients[cid].on('readable', function (size) {
        var chunk;

        if (!localclients[cid]) {
          console.error("[error] localclients[cid]", cid);
          return;
        }
        if (!localclients[cid].read) {
          console.error("[error] localclients[cid].read", cid);
          console.log(localclients[cid]);
          return;
        }

        do {
          chunk = localclients[cid].read(size);
          //console.log("[<=] local '" + opts.service + "' sent to '" + cid + "' <= ", chunk.byteLength, "bytes");
          //console.log(JSON.stringify(chunk.toString()));
          wstunneler.send(Packer.pack(opts, chunk), { binary: true });
        } while (chunk);
      });
      localclients[cid].on('error', function (err) {
        handlers._onLocalError(cid, opts, err);
      });
      localclients[cid].on('end', function () {
        console.info("[end] closing client '" + cid + "' for '" + servername + "' (" + (handlers._numClients() - 1) + " clients)");
        handlers._onLocalClose(cid, opts);
      });
      //localclients[cid].pause();
      localclients[cid].write(opts.data);
    }
  , onend: function (opts) {
      var cid = Packer.addrToId(opts);
      //console.log("[end] '" + cid + "'");
      handlers._onend(cid);
    }
  , onerror: function (opts) {
      var cid = Packer.addrToId(opts);
      //console.log("[error] '" + cid + "'", opts.code || '', opts.message);
      handlers._onend(cid);
    }
  , _onend: function (cid) {
      console.log('[_onend]');
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
      console.log('[_onLocalClose]');
      try {
        wstunneler.send(Packer.pack(opts, null, err && 'error' || 'end'), { binary: true });
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
    }

  , retry: true
  , closeClients: function () {
      console.log('[close clients]');
      Object.keys(localclients).forEach(function (cid) {
        try {
          localclients[cid].end();
        } catch(e) {
          // ignore
        }
        delete localclients[cid];
      });
    }

  , onClose: function () {
    console.log('ON CLOSE');
      if (!authenticated) {
        console.info('[close] failed on first attempt... check authentication.');
      }
      else if (wsHandlers.retry) {
        console.info('[retry] disconnected and waiting...');
        setTimeout(run, 5000, copts);
      }
      else {
        console.info('[close] closing tunnel to exit...');
      }

      process.removeListener('exit', wsHandlers.onExit);
      process.removeListener('SIGINT', wsHandlers.onExit);
      wsHandlers.closeClients();
    }

  , onError: function (err) {
      console.error("[tunnel error] " + err.message);
      console.error(err);
    }

  , onExit: function () {
      console.log('[wait] closing wstunneler...');
      wsHandlers.retry = false;
      wsHandlers.closeClients();
      try {
        wstunneler.close();
      } catch(e) {
        console.error("[error] wstunneler.close()");
        console.error(e);
        // ignore
      }
    }
  };
  var machine = require('tunnel-packer').create(handlers);

  console.info("[connect] '" + copts.stunneld + "'");

  wstunneler = new WebSocket(tunnelUrl, { rejectUnauthorized: !copts.insecure });
  wstunneler.on('open', wsHandlers.onOpen);
  wstunneler.on('message', function (data, flags) {
    if (data.error || '{' === data[0]) {
      console.log(data);
      return;
    }
    machine.fns.addChunk(data, flags);
  });
  wstunneler.on('close', wsHandlers.onClose);
  wstunneler.on('error', wsHandlers.onError);
  process.on('beforeExit', function (x) {
    console.log('[beforeExit] event loop closing?', x);
  });
  process.on('exit', function (x) {
    console.log('[exit] loop closed', x);
    //wsHandlers.onExit(x);
  });
  process.on('SIGINT', function (x) {
    console.log('SIGINT');
    wsHandlers.onExit(x);
  });
}

module.exports.connect = run;

}());

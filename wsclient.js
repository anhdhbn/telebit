(function () {
'use strict';

var WebSocket = require('ws');
var sni = require('sni');
var Packer = require('tunnel-packer');
var authenticated = false;

function run(copts) {
  var tunnelUrl = copts.stunneld.replace(/\/$/, '') + '/?access_token=' + copts.token;
  var wstunneler;

  var localclients = {};
  var clientHandlers = {
    onClose: function (cid, opts, err) {
      try {
        wstunneler.send(Packer.pack(opts, null, err && 'error' || 'end'), { binary: true });
      } catch(e) {
        // ignore
      }
      delete localclients[cid];
      console.log('[local onClose] closed "' + cid + '" (' + clientHandlers.count() + ' clients)');
    }
  , onError: function(cid, opts, err) {
      console.info("[local onError] closing '" + cid + "' because '" + err.message + "'");
      clientHandlers.onClose(cid, opts, err);
    }

  , closeSingle: function (cid) {
      if (!localclients[cid]) {
        return;
      }

      console.log('[closeSingle]', cid);
      try {
        localclients[cid].end();
        setTimeout(function () {
          if (localclients[cid]) {
            console.warn('[closeSingle]', cid, 'connection still present');
            delete localclients[cid];
          }
        }, 500);
      } catch (err) {
        console.warn('[closeSingle] failed to close connection', cid, err);
        delete localclients[cid];
      }
    }
  , closeAll: function () {
      console.log('[closeAll]');
      Object.keys(localclients).forEach(function (cid) {
        try {
          localclients[cid].end();
        } catch (err) {
          console.warn('[closeAll] failed to close connection', cid, err);
        }
      });

      setTimeout(function () {
        Object.keys(localclients).forEach(function (cid) {
          if (localclients[cid]) {
            console.warn('[closeAll]', cid, 'connection still present');
            delete localclients[cid];
          }
        });
      }, 500);
    }

  , count: function () {
      return Object.keys(localclients).length;
    }
  };

  var packerHandlers = {
    onmessage: function (opts) {
      var net = copts.net || require('net');
      var cid = Packer.addrToId(opts);
      var service = opts.service.toLowerCase();
      var portList = copts.services[service];
      var servername;
      var port;
      var str;
      var m;

      authenticated = true;

      if (localclients[cid]) {
        //console.log("[=>] received data from '" + cid + "' =>", opts.data.byteLength);
        localclients[cid].write(opts.data);
        return;
      }
      if (!portList) {
        packerHandlers._onConnectError(cid, opts, new Error("unsupported service '" + service + "'"));
        return;
      }

      if ('http' === service) {
        str = opts.data.toString();
        m = str.match(/(?:^|[\r\n])Host: ([^\r\n]+)[\r\n]*/im);
        servername = (m && m[1].toLowerCase() || '').split(':')[0];
      }
      else if ('https' === service) {
        servername = sni(opts.data);
      }
      else {
        servername = '*';
      }

      if (!servername) {
        //console.warn(opts.data.toString());
        packerHandlers._onConnectError(cid, opts, new Error("missing servername for '" + cid + "' " + opts.data.byteLength));
        return;
      }

      port = portList[servername] || portList['*'];
      console.log('port', port, opts.port, service, portList);
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
        // this will happen before 'data' is triggered
        localclients[cid].write(opts.data);
      });
      console.info("[connect] new client '" + cid + "' for '" + servername + "' (" + clientHandlers.count() + " clients)");

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
          if (chunk) {
            wstunneler.send(Packer.pack(opts, chunk), { binary: true });
          }
        } while (chunk);
      });
      localclients[cid].on('error', clientHandlers.onError.bind(null, cid, opts));
      localclients[cid].on('end',   clientHandlers.onClose.bind(null, cid, opts));
    }
  , onend: function (opts) {
      var cid = Packer.addrToId(opts);
      //console.log("[end] '" + cid + "'");
      clientHandlers.closeSingle(cid);
    }
  , onerror: function (opts) {
      var cid = Packer.addrToId(opts);
      //console.log("[error] '" + cid + "'", opts.code || '', opts.message);
      clientHandlers.closeSingle(cid);
    }
  , _onConnectError: function (cid, opts, err) {
      console.info("[_onConnectError] opening '" + cid + "' failed because " + err.message);
      try {
        wstunneler.send(Packer.pack(opts, null, 'error'), { binary: true });
      } catch(e) {
        // ignore
      }
    }
  };

  var wsHandlers = {
    onOpen: function () {
      console.info("[open] connected to '" + copts.stunneld + "'");
    }

  , retry: true
  , onClose: function () {
      console.log('ON CLOSE');
      clientHandlers.closeAll();

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
    }

  , onError: function (err) {
      console.error("[tunnel error] " + err.message);
      console.error(err);
    }

  , onExit: function () {
      console.log('[wait] closing wstunneler...');
      wsHandlers.retry = false;

      try {
        wstunneler.close();
      } catch(e) {
        console.error("[error] wstunneler.close()");
        console.error(e);
        process.exit(1);
      }
    }
  };
  var machine = require('tunnel-packer').create(packerHandlers);

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

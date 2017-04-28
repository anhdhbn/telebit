(function () {
'use strict';

var WebSocket = require('ws');
var PromiseA = require('bluebird');
var sni = require('sni');
var Packer = require('tunnel-packer');

function run(copts) {
  var tokens = [ copts.token ];
  var activityTimeout = copts.activityTimeout || 2*60*1000;
  var pongTimeout = copts.pongTimeout || 10*1000;

  var wstunneler;
  var authenticated = false;

  var localclients = {};
  var clientHandlers = {
    onClose: function (cid, opts, err) {
      wsHandlers.sendMessage(Packer.pack(opts, null, err && 'error' || 'end'));
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

  var pendingCommands = {};
  function sendCommand(name) {
    var id = Math.ceil(1e9 * Math.random());
    var cmd = [id, name].concat(Array.prototype.slice.call(arguments, 1));

    wsHandlers.sendMessage(Packer.pack(null, cmd, 'control'));
    setTimeout(function () {
      if (pendingCommands[id]) {
        console.warn('command', id, 'timed out');
        pendingCommands[id]({
          message: 'response not received in time'
        , code: 'E_TIMEOUT'
        });
      }
    }, pongTimeout);

    return new PromiseA(function (resolve, reject) {
      pendingCommands[id] = function (err, result) {
        delete pendingCommands[id];
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      };
    });
  }

  function sendAllTokens() {
    tokens.forEach(function (jwtoken) {
      sendCommand('add_token', jwtoken)
        .catch(function (err) {
          console.error('failed re-adding token', jwtoken, 'after reconnect', err);
          // Not sure if we should do something like remove the token here. It worked
          // once or it shouldn't have stayed in the list, so it's less certain why
          // it would have failed here.
        });
    });
  }

  var packerHandlers = {
    oncontrol: function (opts) {
      var cmd, err;
      try {
        cmd = JSON.parse(opts.data.toString());
      } catch (err) {}
      if (!Array.isArray(cmd) || typeof cmd[0] !== 'number') {
        console.warn('received bad command "' + opts.data.toString() + '"');
        return;
      }

      if (cmd[0] < 0) {
        var cb = pendingCommands[-cmd[0]];
        if (!cb) {
          console.warn('received response for unknown request:', cmd);
        } else {
          cb.apply(null, cmd.slice(1));
        }
        return;
      }

      if (cmd[0] === 0) {
        console.warn('received dis-associated error from server', cmd[1]);
        return;
      }

      if (cmd[1] === 'hello') {
        // We only get the 'hello' event after the token has been validated
        authenticated = true;
        sendAllTokens();
        // TODO: handle the versions and commands provided by 'hello' - isn't super important
        // yet since there is only one version and set up commands.
        err = null;
      }
      else {
        err = { message: 'unknown command "'+cmd[1]+'"', code: 'E_UNKNOWN_COMMAND' };
      }

      wsHandlers.sendMessage(Packer.pack(null, [-cmd[0], err], 'control'));
    }
  , onmessage: function (opts) {
      var net = copts.net || require('net');
      var cid = Packer.addrToId(opts);
      var service = opts.service.toLowerCase();
      var portList = copts.services[service];
      var servername;
      var port;
      var str;
      var m;

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
      var createOpts = {
        port: port
      , host: '127.0.0.1'

      , servername: servername
      , data: opts.data
      , remoteFamily: opts.family
      , remoteAddress: opts.address
      , remotePort: opts.port
      };
      localclients[cid] = net.createConnection(createOpts, function () {
        // this will happen before 'data' or 'readable' is triggered
        // We use the data from the createOpts object so that the createConnection function has
        // the oppurtunity of removing/changing it if it wants/needs to handle it differently.
        if (createOpts.data) {
          localclients[cid].write(createOpts.data);
        }
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
            wsHandlers.sendMessage(Packer.pack(opts, chunk));
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
      wsHandlers.sendMessage(Packer.pack(opts, null, 'error'));
    }
  };

  var lastActivity;
  var timeoutId;
  var wsHandlers = {
    refreshTimeout: function () {
      lastActivity = Date.now();
    }
  , checkTimeout: function () {
      if (!wstunneler) {
        console.warn('checkTimeout called when websocket already closed');
        return;
      }
      // Determine how long the connection has been "silent", ie no activity.
      var silent = Date.now() - lastActivity;

      // If we have had activity within the last activityTimeout then all we need to do is
      // call this function again at the soonest time when the connection could be timed out.
      if (silent < activityTimeout) {
        timeoutId = setTimeout(wsHandlers.checkTimeout, activityTimeout-silent);
      }

      // Otherwise we check to see if the pong has also timed out, and if not we send a ping
      // and call this function again when the pong will have timed out.
      else if (silent < activityTimeout + pongTimeout) {
        console.log('pinging tunnel server');
        try {
          wstunneler.ping();
        } catch (err) {
          console.warn('failed to ping tunnel server', err);
        }
        timeoutId = setTimeout(wsHandlers.checkTimeout, pongTimeout);
      }

      // Last case means the ping we sent before didn't get a response soon enough, so we
      // need to close the websocket connection.
      else {
        console.log('connection timed out');
        wstunneler.close(1000, 'connection timeout');
      }
    }

  , onOpen: function () {
      console.info("[open] connected to '" + copts.stunneld + "'");
      wsHandlers.refreshTimeout();
      timeoutId = setTimeout(wsHandlers.checkTimeout, activityTimeout);
    }

  , onClose: function () {
      console.log('ON CLOSE');
      clearTimeout(timeoutId);
      wstunneler = null;
      clientHandlers.closeAll();
      Object.keys(pendingCommands).forEach(function (id) {
        pendingCommands[id]({
          message: 'websocket connection closed before response'
        , code: 'E_CONN_CLOSED'
        });
      });

      if (!authenticated) {
        console.info('[close] failed on first attempt... check authentication.');
        timeoutId = null;
      }
      else if (tokens.length) {
        console.info('[retry] disconnected and waiting...');
        timeoutId = setTimeout(connect, 5000);
      }
    }

  , onError: function (err) {
      console.error("[tunnel error] " + err.message);
      console.error(err);
    }

  , sendMessage: function (msg) {
      if (wstunneler) {
        try {
          wstunneler.send(msg, {binary: true});
        } catch (err) {
          // There is a chance that this occurred after the websocket was told to close
          // and before it finished, in which case we don't need to log the error.
          if (wstunneler.readyState !== wstunneler.CLOSING) {
            console.warn('[sendMessage] error sending websocket message', err);
          }
        }
      }
    }
  };

  function connect() {
    if (!tokens.length) {
      return;
    }
    timeoutId = null;
    var machine = require('tunnel-packer').create(packerHandlers);

    console.info("[connect] '" + copts.stunneld + "'");
    var tunnelUrl = copts.stunneld.replace(/\/$/, '') + '/?access_token=' + tokens[0];
    wstunneler = new WebSocket(tunnelUrl, { rejectUnauthorized: !copts.insecure });
    wstunneler.on('open', wsHandlers.onOpen);
    wstunneler.on('close', wsHandlers.onClose);
    wstunneler.on('error', wsHandlers.onError);

    // Our library will automatically handle sending the pong respose to ping requests.
    wstunneler.on('ping', wsHandlers.refreshTimeout);
    wstunneler.on('pong', wsHandlers.refreshTimeout);
    wstunneler.on('message', function (data, flags) {
      wsHandlers.refreshTimeout();
      if (data.error || '{' === data[0]) {
        console.log(data);
        return;
      }
      machine.fns.addChunk(data, flags);
    });
  }
  connect();

  return {
    end: function() {
      tokens.length = 0;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (wstunneler) {
        try {
          wstunneler.close();
        } catch(e) {
          console.error("[error] wstunneler.close()");
          console.error(e);
        }
      }
    }
  , append: function (token) {
      if (tokens.indexOf(token) >= 0) {
        return PromiseA.resolve();
      }
      tokens.push(token);

      var prom = sendCommand('add_token', token);
      prom.catch(function (err) {
        console.error('adding token', token, 'failed:', err);
        // Most probably an invalid token of some kind, so we don't really want to keep it.
        tokens.splice(tokens.indexOf(token));
      });

      return prom;
    }
  , clear: function (token) {
      if (typeof token === 'undefined') {
        token = '*';
      }

      if (token === '*') {
        tokens.length = 0;
      } else {
        var index = tokens.indexOf(token);
        if (index < 0) {
          return PromiseA.resolve();
        }
        tokens.splice(index);
      }

      var prom = sendCommand('delete_token', token);
      prom.catch(function (err) {
        console.error('clearing token', token, 'failed:', err);
      });

      return prom;
    }
  };
}

module.exports.connect = run;
module.exports.createConnection = run;

}());

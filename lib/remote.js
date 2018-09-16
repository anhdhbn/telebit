(function () {
'use strict';

var PromiseA;
try {
  PromiseA = require('bluebird');
} catch(e) {
  PromiseA = global.Promise;
}
var WebSocket = require('ws');
var sni = require('sni');
var Packer = require('proxy-packer');
var os = require('os');
var EventEmitter = require('events').EventEmitter;

function timeoutPromise(duration) {
  return new PromiseA(function (resolve) {
    setTimeout(resolve, duration);
  });
}

function TelebitRemote(state) {
  // jshint latedef:false

  if (!(this instanceof TelebitRemote)) {
    return new TelebitRemote(state);
  }
  EventEmitter.call(this);
  var me = this;
  var priv = {};

  //var defaultHttpTimeout = (2 * 60);
  //var activityTimeout = state.activityTimeout || (defaultHttpTimeout - 5) * 1000;
  var activityTimeout = 6 * 1000;
  var pongTimeout = state.pongTimeout || 10*1000;
  // Allow the tunnel client to be created with no token. This will prevent the connection from
  // being established initialy and allows the caller to use `.append` for the first token so
  // they can get a promise that will provide feedback about invalid tokens.
  priv.tokens = [];
  var auth;
  if(!state.sortingHat) {
    state.sortingHat = "./sorting-hat.js";
  }
  if (state.token) {
    if ('undefined' === state.token) {
      throw new Error("passed string 'undefined' as token");
    }
    priv.tokens.push(state.token);
  }

  var wstunneler;
  var authenticated = false;
  var authsent = false;
  var initialConnect = true;

  priv.localclients = {};
  var pausedClients = [];
  var clientHandlers = {
    add: function (conn, cid, tun) {
      priv.localclients[cid] = conn;
      console.info("[connect] new client '" + tun.name + ":" + tun.serviceport + "' for  '" + cid + "'"
        + "(" + clientHandlers.count() + " clients)");

      conn.tunnelCid = cid;
      if (tun.data) {
        conn.tunnelRead = tun.data.byteLength;
      } else {
        conn.tunnelRead = 0;
      }
      conn.tunnelWritten = 0;

      conn.on('data', function onLocalData(chunk) {
        //var chunk = conn.read();
        if (conn.tunnelClosing) {
          console.warn("[onLocalData] received data for '"+cid+"' over socket after connection was ended");
          return;
        }
        // This value is bytes written to the tunnel (ie read from the local connection)
        conn.tunnelWritten += chunk.byteLength;

        // If we have a lot of buffered data waiting to be sent over the websocket we want to slow
        // down the data we are getting to send over. We also want to pause all active connections
        // if any connections are paused to make things more fair so one connection doesn't get
        // stuff waiting for all other connections to finish because it tried writing near the border.
        var bufSize = sendMessage(Packer.packHeader(tun, chunk));
        // Sending 2 messages instead of copying the buffer
        var bufSize2 = sendMessage(chunk);
        if (pausedClients.length || (bufSize + bufSize2) > 1024*1024) {
          // console.log('[onLocalData] paused connection', cid, 'to allow websocket to catch up');
          conn.pause();
          pausedClients.push(conn);
        }
      });

      var sentEnd = false;
      conn.on('end', function onLocalEnd() {
        //console.info("[onLocalEnd] connection '" + cid + "' ended, will probably close soon");
        conn.tunnelClosing = true;
        if (!sentEnd) {
          sendMessage(Packer.packHeader(tun, null, 'end'));
          sentEnd = true;
        }
      });
      conn.on('error', function onLocalError(err) {
        console.info("[onLocalError] connection '" + cid + "' errored:", err);
        if (!sentEnd) {
          var packBody = true;
          sendMessage(Packer.packHeader(tun, {message: err.message, code: err.code}, 'error', packBody));
          sentEnd = true;
        }
      });
      conn.on('close', function onLocalClose(hadErr) {
        delete priv.localclients[cid];
        console.log('[onLocalClose] closed "' + cid + '" read:'+conn.tunnelRead+', wrote:'+conn.tunnelWritten+' (' + clientHandlers.count() + ' clients)');
        if (!sentEnd) {
          sendMessage(Packer.packHeader(tun, null, hadErr && 'error' || 'end'));
          sentEnd = true;
        }
      });
    }

  , write: function (cid, opts) {
      var conn = priv.localclients[cid];
      if (!conn) {
        return false;
      }
      //console.log("[=>] received data from '" + cid + "' =>", opts.data.byteLength);

      if (conn.tunnelClosing) {
        console.warn("[onmessage] received data for '"+cid+"' over socket after connection was ended");
        return true;
      }

      conn.write(opts.data);
      // It might seem weird to increase the "read" value in a function named `write`, but this
      // is bytes read from the tunnel and written to the local connection.
      conn.tunnelRead += opts.data.byteLength;

      if (!conn.remotePaused && conn.bufferSize > 1024*1024) {
        var packBody = true;
        sendMessage(Packer.packHeader(opts, conn.tunnelRead, 'pause', packBody));
        conn.remotePaused = true;

        conn.once('drain', function () {
          var packBody = true;
          sendMessage(Packer.packHeader(opts, conn.tunnelRead, 'resume', packBody));
          conn.remotePaused = false;
        });
      }
      return true;
    }

  , closeSingle: function (cid) {
      if (!priv.localclients[cid]) {
        return;
      }

      //console.log('[closeSingle]', cid);
      PromiseA.resolve().then(function () {
        var conn = priv.localclients[cid];
        conn.tunnelClosing = true;
        conn.end();

        // If no data is buffered for writing then we don't need to wait for it to drain.
        if (!conn.bufferSize) {
          return timeoutPromise(500);
        }
        // Otherwise we want the connection to be able to finish, but we also want to impose
        // a time limit for it to drain, since it shouldn't have more than 1MB buffered.
        return new PromiseA(function (resolve) {
          var timeoutId = setTimeout(resolve, 60*1000);
          conn.once('drain', function () {
            clearTimeout(timeoutId);
            setTimeout(resolve, 500);
          });
        });
      }).then(function () {
        if (priv.localclients[cid]) {
          console.warn('[closeSingle]', cid, 'connection still present after calling `end`');
          priv.localclients[cid].destroy();
          return timeoutPromise(500);
        }
      }).then(function () {
        if (priv.localclients[cid]) {
          console.error('[closeSingle]', cid, 'connection still present after calling `destroy`');
          delete priv.localclients[cid];
        }
      }).catch(function (err) {
        console.error('[closeSingle] failed to close connection', cid, err.toString());
        delete priv.localclients[cid];
      });
    }
  , closeAll: function () {
      console.log('[closeAll]');
      Object.keys(priv.localclients).forEach(function (cid) {
        clientHandlers.closeSingle(cid);
      });
    }

  , count: function () {
      return Object.keys(priv.localclients).length;
    }
  };

  var pendingCommands = {};
  function sendMessage(msg) {
    // There is a chance that this occurred after the websocket was told to close
    // and before it finished, in which case we don't need to log the error.
    if (wstunneler.readyState !== wstunneler.CLOSING) {
        wstunneler.send(msg, {binary: true});
        return wstunneler.bufferedAmount;
    }
  }
  function sendCommand(name) {
    var id = Math.ceil(1e9 * Math.random());
    var cmd = [id, name].concat(Array.prototype.slice.call(arguments, 1));
    if (state.debug) { console.log('[DEBUG] command sending', cmd); }

    var packBody = true;
    sendMessage(Packer.packHeader(null, cmd, 'control', packBody));
    setTimeout(function () {
      if (pendingCommands[id]) {
        console.warn('command', name, id, 'timed out');
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

  function noHandler(cmd) {
    console.warn("[telebit] state.handlers['" + cmd[1] + "'] not set");
    console.warn(cmd[2]);
  }

  var connCallback;

  function hyperPeek(tun) {
    var m;
    var str;
    if (tun.data) {
      if ('http' === tun.service) {
        str = tun.data.toString();
        m = str.match(/(?:^|[\r\n])Host: ([^\r\n]+)[\r\n]*/im);
        tun._name = tun._hostname = (m && m[1].toLowerCase() || '').split(':')[0];
      }
      else if ('https' === tun.service || 'tls' === tun.service) {
        tun._name = tun._servername = sni(tun.data);
      } else {
        tun._name = '';
      }
    }
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
        if (connCallback) {
          connCallback(cmd[1]);
        }
        return;
      }

      if (cmd[1] === 'hello') {
        if (state.debug) { console.log('[DEBUG] hello received'); }
        if (auth) {
          authsent = true;
          sendCommand('auth', auth).catch(function (err) { console.error('1', err); });
        }
        priv.tokens.forEach(function (jwtoken) {
          if (state.debug) { console.log('[DEBUG] send token'); }
          authsent = true;
          sendCommand('add_token', jwtoken)
            .catch(function (err) {
              console.error('failed re-adding token', jwtoken, 'after reconnect', err);
              // Not sure if we should do something like remove the token here. It worked
              // once or it shouldn't have stayed in the list, so it's less certain why
              // it would have failed here.
            });
        });
        if (connCallback) {
          connCallback();
        }
        // TODO: handle the versions and commands provided by 'hello' - isn't super important
        // yet since there is only one version and set of commands.
        err = null;
      } else if (cmd[1] === 'grant') {
        authenticated = true;
        if (state.handlers[cmd[1]]) {
          state.handlers[cmd[1]](cmd[2]);
        } else {
          noHandler(cmd);
        }
        return;
      } else if (cmd[1] === 'access_token') {
        authenticated = true;
        if (state.handlers[cmd[1]]) {
          state.handlers[cmd[1]](cmd[2]);
        } else {
          noHandler(cmd);
        }
        return;
      } else {
        err = { message: 'unknown command "'+cmd[1]+'"', code: 'E_UNKNOWN_COMMAND' };
      }

      var packBody = true;
      sendMessage(Packer.packHeader(null, [-cmd[0], err], 'control', packBody));
    }

  , onconnection: function (tun) {
      var cid = tun._id = Packer.addrToId(tun);

      // this data should have been gathered already as part of the proxy protocol
      // but if it's available again here we can double check
      hyperPeek(tun);

      // TODO use readable streams instead
      wstunneler._socket.pause();
      require(state.sortingHat).assign(state, tun, function (err, conn) {
        if (err) {
          err.message = err.message.replace(/:tun_id/, tun._id);
          packerHandlers._onConnectError(cid, tun, err);
          return;
        }
        clientHandlers.add(conn, cid, tun);
        if (tun.data) { conn.write(tun.data); }
        wstunneler._socket.resume();
      });
    }

  , onmessage: function (tun) {
      var cid = tun._id = Packer.addrToId(tun);
      var handled;

      hyperPeek(tun);

      handled = clientHandlers.write(cid, tun);

      // quasi backwards compat
      if (!handled) { console.log("[debug] did not get 'connection' event"); packerHandlers.onconnection(tun); }
    }

  , onpause: function (opts) {
      var cid = Packer.addrToId(opts);
      if (priv.localclients[cid]) {
        console.log("[TunnelPause] pausing '"+cid+"', remote received", opts.data.toString(), 'of', priv.localclients[cid].tunnelWritten, 'sent');
        priv.localclients[cid].manualPause = true;
        priv.localclients[cid].pause();
      } else {
        console.log('[TunnelPause] remote tried pausing finished connection', cid);
        // Often we have enough latency that we've finished sending before we're told to pause, so
        // don't worry about sending back errors, since we won't be sending data over anyway.
        // var packBody = true;
        // sendMessage(Packer.packHeader(opts, {message: 'no matching connection', code: 'E_NO_CONN'}, 'error', packBody));
      }
    }
  , onresume: function (opts) {
      var cid = Packer.addrToId(opts);
      if (priv.localclients[cid]) {
        console.log("[TunnelResume] resuming '"+cid+"', remote received", opts.data.toString(), 'of', priv.localclients[cid].tunnelWritten, 'sent');
        priv.localclients[cid].manualPause = false;
        priv.localclients[cid].resume();
      } else {
        console.log('[TunnelResume] remote tried resuming finished connection', cid);
        // var packBody = true;
        // sendMessage(Packer.packHeader(opts, {message: 'no matching connection', code: 'E_NO_CONN'}, 'error', packBody));
      }
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
      sendMessage(Packer.packHeader(opts, null, 'error'));
    }
  };

  priv.timeoutId = null;
  priv.lastActivity = Date.now();
  priv.refreshTimeout = function refreshTimeout() {
    priv.lastActivity = Date.now();
  };
  priv.checkTimeout = function checkTimeout() {
    if (!wstunneler) {
      console.warn('checkTimeout called when websocket already closed');
      return;
    }
    // Determine how long the connection has been "silent", ie no activity.
    var silent = Date.now() - priv.lastActivity;

    // If we have had activity within the last activityTimeout then all we need to do is
    // call this function again at the soonest time when the connection could be timed out.
    if (silent < activityTimeout) {
      priv.timeoutId = setTimeout(priv.checkTimeout, activityTimeout-silent);
    }

    // Otherwise we check to see if the pong has also timed out, and if not we send a ping
    // and call this function again when the pong will have timed out.
    else if (silent < activityTimeout + pongTimeout) {
      //console.log('DEBUG: pinging tunnel server');
      try {
        wstunneler.ping();
      } catch (err) {
        console.warn('failed to ping tunnel server', err);
      }
      priv.timeoutId = setTimeout(priv.checkTimeout, pongTimeout);
    }

    // Last case means the ping we sent before didn't get a response soon enough, so we
    // need to close the websocket connection.
    else {
      console.info('[info] closing due to connection timeout');
      wstunneler.close(1000, 'connection timeout');
    }
  };

  me.destroy = function destroy() {
    console.info('[info] destroy()');
    try {
      //wstunneler.close(1000, 're-connect');
      wstunneler._socket.destroy();
    } catch(e) {
      // ignore
    }
  };
  me.connect = function connect() {
    if (!priv.tokens.length && state.config.email) {
      auth = TelebitRemote._tokenFromState(state);
    }
    priv.timeoutId = null;
    var machine = Packer.create(packerHandlers);

    console.info("[telebit:lib/remote.js] [connect] '" + (state.wss || state.relay) + "'");
    var tunnelUrl = (state.wss || state.relay).replace(/\/$/, '') + '/'; // + auth;
    wstunneler = new WebSocket(tunnelUrl, { rejectUnauthorized: !state.insecure });
    // XXXXXX
    wstunneler.on('open', function () {
      console.info("[telebit:lib/remote.js] [open] connected to '" + (state.wss || state.relay) + "'");
      me.emit('connect');
      priv.refreshTimeout();
      priv.timeoutId = setTimeout(priv.checkTimeout, activityTimeout);
      wstunneler._socket.on('drain', function () {
        // the websocket library has it's own buffer apart from node's socket buffer, but that one
        // is much more difficult to watch, so we watch for the lower level buffer to drain and
        // then check to see if the upper level buffer is still too full to write to. Note that
        // the websocket library buffer has something to do with compression, so I'm not requiring
        // that to be 0 before we start up again.
        if (wstunneler.bufferedAmount > 128*1024) {
          return;
        }

        pausedClients.forEach(function (conn) {
          if (!conn.manualPause) {
            // console.log('resuming connection', conn.tunnelCid, 'now the websocket has caught up');
            conn.resume();
          }
        });
        pausedClients.length = 0;
      });
      initialConnect = false;
    });
    wstunneler.on('close', function () {
      console.info("[info] [closing] received close signal from relay");
      clearTimeout(priv.timeoutId);
      clientHandlers.closeAll();

      var error = new Error('websocket connection closed before response');
      error.code = 'E_CONN_CLOSED';
      Object.keys(pendingCommands).forEach(function (id) {
        pendingCommands[id](error);
      });
      if (connCallback) {
        connCallback(error);
      }

      me.emit('close');
    });
    wstunneler.on('error', function (err) {
      me.emit('error', err);
    });

    // Our library will automatically handle sending the pong respose to ping requests.
    wstunneler.on('ping', priv.refreshTimeout);
    wstunneler.on('pong', function () {
      //console.log('DEBUG received pong');
      priv.refreshTimeout();
    });
    wstunneler.on('message', function (data, flags) {
      priv.refreshTimeout();
      if (data.error || '{' === data[0]) {
        console.log(data);
        return;
      }
      machine.fns.addChunk(data, flags);
    });
  };
  me.end = function() {
    priv.tokens.length = 0;
    if (priv.timeoutId) {
      clearTimeout(priv.timeoutId);
      priv.timeoutId = null;
    }
    console.info('[info] closing due to tr.end()');
    wstunneler.close(1000, 're-connect');
    wstunneler.on('close', function () {
      me.emit('end');
    });
  };
}

TelebitRemote.prototype = EventEmitter.prototype;
TelebitRemote._tokenFromState = function (state) {
  return {
    subject: state.config.email
  , subject_scheme: 'mailto'
    // TODO create domains list earlier
  , scope: Object.keys(state.config.servernames || {}).join(',')
  , otp: state.otp
  , hostname: os.hostname()
    // Used for User-Agent
  , os_type: os.type()
  , os_platform: os.platform()
  , os_release: os.release()
  , os_arch: os.arch()
  };
};

TelebitRemote.create = function (opts) {
  return new TelebitRemote(opts);
};
TelebitRemote.createConnection = function (opts, cb) {
  var tunnel = TelebitRemote.create(opts);
  tunnel.connect(opts);
  tunnel.once('connect', cb);
  return tunnel;
};
TelebitRemote.connect = TelebitRemote.createConnection;

module.exports.TelebitRemote = TelebitRemote;

}());

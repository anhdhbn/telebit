(function () {
'use strict';

// TODO use stream-based ws
// https://github.com/websockets/ws/issues/596

var PromiseA;
try {
  PromiseA = require('bluebird');
} catch(e) {
  PromiseA = global.Promise;
}
var WebSocket = require('ws');
var Packer = require('proxy-packer');
var os = require('os');

function timeoutPromise(duration) {
  return new PromiseA(function (resolve) {
    setTimeout(resolve, duration);
  });
}

function _connect(state) {
  // Allow the tunnel client to be created with no token. This will prevent the connection from
  // being established initialy and allows the caller to use `.append` for the first token so
  // they can get a promise that will provide feedback about invalid tokens.
  if(!state.sortingHat) {
    state.sortingHat = "./sorting-hat.js";
  }

  var sharedPausedClients = [];
  var sharedTimeoutId;
  var client = require('./client').create({});
  // client.wstunneler = null;
  // client.pendingCommands = {};
  // client.machine = machine<Packer>
  // client.auth = null;
  // client.sharedTokens = [];
  // client.localclients = {};
  // client.authenticated = false;
  client._state = state;

  if (state.token) {
    if ('undefined' === state.token) {
      throw new Error("passed string 'undefined' as token");
    }
    client.sharedTokens.push(state.token);
  }

  var clientHandlers = {
    _initialConnect: true
  , add: function (conn, cid, tun) {
      client.localclients[cid] = conn;
      console.info("[connect] new client '" + cid + "' for '" + tun.name + ":" + tun.serviceport + "' "
        + "(" + clientHandlers.count() + " clients)");

      conn.tunnelCid = cid;
      if (tun.data) {
        conn.tunnelRead = tun.data.byteLength;
      } else {
        conn.tunnelRead = 0;
      }
      conn.tunnelWritten = 0;

      // TODO use readable
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
        var bufSize = wsTunnelRemote.sendMessage(Packer.packHeader(tun, chunk));
        // Sending 2 messages instead of copying the buffer
        var bufSize2 = wsTunnelRemote.sendMessage(chunk);
        if (sharedPausedClients.length || (bufSize + bufSize2) > 1024*1024) {
          // console.log('[onLocalData] paused connection', cid, 'to allow websocket to catch up');
          conn.pause();
          sharedPausedClients.push(conn);
        }
      });

      var sentEnd = false;
      conn.on('end', function onLocalEnd() {
        console.info("[onLocalEnd] connection '" + cid + "' ended, will probably close soon");
        conn.tunnelClosing = true;
        if (!sentEnd) {
          wsTunnelRemote.sendMessage(Packer.packHeader(tun, null, 'end'));
          sentEnd = true;
        }
      });
      conn.on('error', function onLocalError(err) {
        console.info("[onLocalError] connection '" + cid + "' errored:", err);
        if (!sentEnd) {
          var packBody = true;
          wsTunnelRemote.sendMessage(Packer.packHeader(tun, {message: err.message, code: err.code}, 'error', packBody));
          sentEnd = true;
        }
      });
      conn.on('close', function onLocalClose(hadErr) {
        delete client.localclients[cid];
        console.log('[onLocalClose] closed "' + cid + '" read:'+conn.tunnelRead+', wrote:'+conn.tunnelWritten+' (' + clientHandlers.count() + ' clients)');
        if (!sentEnd) {
          wsTunnelRemote.sendMessage(Packer.packHeader(tun, null, hadErr && 'error' || 'end'));
          sentEnd = true;
        }
      });
    }

  , write: function (cid, opts) {
      var conn = client.localclients[cid];
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
        wsTunnelRemote.sendMessage(Packer.packHeader(opts, conn.tunnelRead, 'pause', packBody));
        conn.remotePaused = true;

        conn.once('drain', function () {
          var packBody = true;
          wsTunnelRemote.sendMessage(Packer.packHeader(opts, conn.tunnelRead, 'resume', packBody));
          conn.remotePaused = false;
        });
      }
      return true;
    }

  , closeSingle: function (cid) {
      if (!client.localclients[cid]) {
        return;
      }

      console.log('[closeSingle]', cid);
      PromiseA.resolve().then(function () {
        var conn = client.localclients[cid];
        conn.tunnelClosing = true;
        conn.end();

        // If no data is buffered for writing then we don't need to wait for it to drain.
        if (!conn.bufferSize) {
          return timeoutPromise(500);
        }
        // Otherwise we want the connection to be able to finish, but we also want to impose
        // a time limit for it to drain, since it shouldn't have more than 1MB buffered.
        return new PromiseA(function (resolve) {
          var myTimeoutId = setTimeout(resolve, 60*1000);
          conn.once('drain', function () {
            clearTimeout(myTimeoutId);
            setTimeout(resolve, 500);
          });
        });
      }).then(function () {
        if (client.localclients[cid]) {
          console.warn('[closeSingle]', cid, 'connection still present after calling `end`');
          client.localclients[cid].destroy();
          return timeoutPromise(500);
        }
      }).then(function () {
        if (client.localclients[cid]) {
          console.error('[closeSingle]', cid, 'connection still present after calling `destroy`');
          delete client.localclients[cid];
        }
      }).catch(function (err) {
        console.error('[closeSingle] failed to close connection', cid, err.toString());
        delete client.localclients[cid];
      });
    }
  , closeAll: function () {
      console.log('[closeAll]');
      Object.keys(client.localclients).forEach(function (cid) {
        clientHandlers.closeSingle(cid);
      });
    }

  , count: function () {
      return Object.keys(client.localclients).length;
    }
  };

  var DEFAULT_HTTP_TIMEOUT = (2 * 60);
  var wsTunnelRemote = {
    _activityTimeout: state.activityTimeout || (DEFAULT_HTTP_TIMEOUT - 5) * 1000
  , _pongTimeout: state.pongTimeout || 10*1000
  , _lastActivity: 0
  , _sendCommand: function (name) {
      var id = Math.ceil(1e9 * Math.random());
      var cmd = [id, name].concat(Array.prototype.slice.call(arguments, 1));
      if (state.debug) { console.log('[DEBUG] command sending', cmd); }

      var packBody = true;
      wsTunnelRemote.sendMessage(Packer.packHeader(null, cmd, 'control', packBody));
      setTimeout(function () {
        if (client.pendingCommands[id]) {
          console.warn('command', name, id, 'timed out');
          client.pendingCommands[id]({
            message: 'response not received in time'
          , code: 'E_TIMEOUT'
          });
        }
      }, wsTunnelRemote._pongTimeout);

      return new PromiseA(function (resolve, reject) {
        client.pendingCommands[id] = function (err, result) {
          delete client.pendingCommands[id];
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        };
      });
    }
  , refreshTimeout: function () {
      wsTunnelRemote._lastActivity = Date.now();
    }
  , checkTimeout: function () {
      if (!client.wstunneler) {
        console.warn('checkTimeout called when websocket already closed');
        return;
      }
      // Determine how long the connection has been "silent", ie no activity.
      var silent = Date.now() - wsTunnelRemote._lastActivity;

      // If we have had activity within the last activityTimeout then all we need to do is
      // call this function again at the soonest time when the connection could be timed out.
      if (silent < wsTunnelRemote._activityTimeout) {
        sharedTimeoutId = setTimeout(wsTunnelRemote.checkTimeout, wsTunnelRemote._activityTimeout-silent);
      }

      // Otherwise we check to see if the pong has also timed out, and if not we send a ping
      // and call this function again when the pong will have timed out.
      else if (silent < wsTunnelRemote._activityTimeout + wsTunnelRemote._pongTimeout) {
        console.log('pinging tunnel server');
        try {
          client.wstunneler.ping();
        } catch (err) {
          console.warn('failed to ping tunnel server', err);
        }
        sharedTimeoutId = setTimeout(wsTunnelRemote.checkTimeout, wsTunnelRemote._pongTimeout);
      }

      // Last case means the ping we sent before didn't get a response soon enough, so we
      // need to close the websocket connection.
      else {
        console.log('connection timed out');
        client.wstunneler.close(1000, 'connection timeout');
      }
    }

  , onOpen: function () {
      console.info("[open] connected to '" + (state.wss || state.relay) + "'");
      wsTunnelRemote.refreshTimeout();

      sharedTimeoutId = setTimeout(wsTunnelRemote.checkTimeout, wsTunnelRemote._activityTimeout);

      client.wstunneler._socket.on('drain', function () {
        // the websocket library has it's own buffer apart from node's socket buffer, but that one
        // is much more difficult to watch, so we watch for the lower level buffer to drain and
        // then check to see if the upper level buffer is still too full to write to. Note that
        // the websocket library buffer has something to do with compression, so I'm not requiring
        // that to be 0 before we start up again.
        if (client.wstunneler.bufferedAmount > 128*1024) {
          return;
        }

        sharedPausedClients.forEach(function (conn) {
          if (!conn.manualPause) {
            // console.log('resuming connection', conn.tunnelCid, 'now the websocket has caught up');
            conn.resume();
          }
        });

        sharedPausedClients.length = 0;
      });

      //Call either Open or Reconnect handlers.
      if(state.handlers.onOpen && clientHandlers._initialConnect) {
        state.handlers.onOpen();
      } else if (state.handlers.onReconnect && !clientHandlers._initialConnect) {
        state.handlers.onReconnect();
      }
      clientHandlers._initialConnect = false;
    }

  , onClose: function () {
      clearTimeout(sharedTimeoutId);
      client.wstunneler = null;
      clientHandlers.closeAll();

      var error = new Error('websocket connection closed before response');
      error.code = 'E_CONN_CLOSED';
      Object.keys(client.pendingCommands).forEach(function (id) {
        client.pendingCommands[id](error);
      });
      if (client.connCallback) {
        client.connCallback(error);
      }

      if (!client.authenticated) {
        if(state.handlers.onError) {
          var err = new Error('Failed to connect on first attempt... check authentication');
          state.handlers.onError(err);
        }
        if(state.handlers.onClose) {
          state.handlers.onClose();
        }
        console.info('[close] failed on first attempt... check authentication.');
        sharedTimeoutId = null;
      }
      else if (client.sharedTokens.length) {
        if(state.handlers.onDisconnect) {
          state.handlers.onDisconnect();
        }
        console.info('[retry] disconnected and waiting...');
        sharedTimeoutId = setTimeout(connect, 5000);
      } else {
        if(state.handlers.onClose) {
          state.handlers.onClose();
        }
      }
    }

  , onError: function (err) {
      if ('ENOTFOUND' === err.code) {
        // DNS issue, probably network is disconnected
        sharedTimeoutId = setTimeout(connect, 90 * 1000);
        return;
      }
      console.error("[tunnel error] " + err.message);
      console.error(err);
      if (client.connCallback) {
        client.connCallback(err);
      }
    }

  , sendMessage: function (msg) {
      if (client.wstunneler) {
        try {
          client.wstunneler.send(msg, {binary: true});
          return client.wstunneler.bufferedAmount;
        } catch (err) {
          // There is a chance that this occurred after the websocket was told to close
          // and before it finished, in which case we don't need to log the error.
          if (client.wstunneler.readyState !== client.wstunneler.CLOSING) {
            console.warn('[sendMessage] error sending websocket message', err);
          }
        }
      }
    }
  };

  function connect() {
    if (client.wstunneler) {
      console.warn('attempted to connect with connection already active');
      return;
    }
    if (!client.sharedTokens.length) {
      if (state.config.email) {
        client.auth = {
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
      }
    }
    sharedTimeoutId = null;

    console.info("[connect] '" + (state.wss || state.relay) + "'");
    var tunnelUrl = (state.wss || state.relay).replace(/\/$/, '') + '/'; // + client.auth;
    var wsOpts = { binary: true, rejectUnauthorized: !state.insecure };
    client.wstunneler = new WebSocket(tunnelUrl, wsOpts);
    client.wsreader = require('./ws-readable').create(client.wstunneler);
    client.wstunneler.on('open', wsTunnelRemote.onOpen);
    client.wstunneler.on('close', wsTunnelRemote.onClose);
    client.wstunneler.on('error', wsTunnelRemote.onError);

    // Our library will automatically handle sending the pong respose to ping requests.
    client.wstunneler.on('ping', wsTunnelRemote.refreshTimeout);
    client.wstunneler.on('pong', wsTunnelRemote.refreshTimeout);
    client.wstunneler.on('message', function (data, flags) {
      wsTunnelRemote.refreshTimeout();
      if (data.error || '{' === data[0]) {
        console.log(data);
        return;
      }
      client.machine.fns.addChunk(data, flags);
    });
  }

  var xyzHandlers = {
    _connPromise: null
  , end: function(cb) {
      client.sharedTokens.length = 0;
      if (sharedTimeoutId) {
        clearTimeout(sharedTimeoutId);
        sharedTimeoutId = null;
      }

      if (client.wstunneler) {
        try {
          client.wstunneler.close(cb);
        } catch(e) {
          console.error("[error] client.wstunneler.close()");
          console.error(e);
        }
      }
    }
  , append: function (token) {
      if (!token) {
        throw new Error("attempted to append empty token");
      }
      if ('undefined' === token) {
        throw new Error("attempted to append token as the string 'undefined'");
      }
      if (client.sharedTokens.indexOf(token) >= 0) {
        return PromiseA.resolve();
      }
      client.sharedTokens.push(token);
      var prom;
      if (client.sharedTokens.length === 1 && !client.wstunneler) {
        // We just added the only token in the list, and the websocket connection isn't up
        // so we need to restart the connection.
        if (sharedTimeoutId) {
          // Handle the case were the last token was removed and this token added between
          // reconnect attempts to make sure we don't try openning multiple connections.
          clearTimeout(sharedTimeoutId);
          sharedTimeoutId = null;
        }

        // We want this case to behave as much like the other case as we can, but we don't have
        // the same kind of reponses when we open brand new connections, so we have to rely on
        // the 'hello' and the 'un-associated' error commands to determine if the token is good.
        prom = xyzHandlers._connPromise = new PromiseA(function (resolve, reject) {
          client.connCallback = function (err) {
            client.connCallback = null;
            xyzHandlers._connPromise = null;
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          };
        });
        connect();
      }
      else if (xyzHandlers._connPromise) {
        prom = xyzHandlers._connPromise.then(function () {
          return wsTunnelRemote._sendCommand('add_token', token);
        });
      }
      else {
        prom = wsTunnelRemote._sendCommand('add_token', token);
      }

      prom.catch(function (err) {
        console.error('adding token', token, 'failed:', err);
        // Most probably an invalid token of some kind, so we don't really want to keep it.
        client.sharedTokens.splice(client.sharedTokens.indexOf(token), 1);
      });

      return prom;
    }
  , clear: function (token) {
      if (typeof token === 'undefined') {
        token = '*';
      }

      if (token === '*') {
        client.sharedTokens.length = 0;
      } else {
        var index = client.sharedTokens.indexOf(token);
        if (index < 0) {
          return PromiseA.resolve();
        }
        client.sharedTokens.splice(index);
      }

      var prom = wsTunnelRemote._sendCommand('delete_token', token);
      prom.catch(function (err) {
        console.error('clearing token', token, 'failed:', err);
      });

      return prom;
    }
  };

  client._wsTunnelRemote = wsTunnelRemote;
  client.clientHandlers = clientHandlers;
  connect();
  return xyzHandlers;
}

module.exports.connect = _connect;
module.exports.createConnection = _connect;

}());

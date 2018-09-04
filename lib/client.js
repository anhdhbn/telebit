'use strict';

var sni = require('sni');
var Packer = require('proxy-packer');

module.exports.create = function (handlers) {
  var client = module.exports;
  client.pendingCommands = {};
  client.auth = null;
  client.wstunneler = null;
  client.localclients = {};
  client.authenticated = false;

  var multiplexed = {};
  var stream = require('stream');
  var Duplex = stream.Duplex;

  function SingleConn(tun, streamOpts) {
		// Proper duplex stream with automatic flow control (backpressure) management
		if(!(this instanceof SingleConn)) { return new SingleConn(tun, streamOpts); }
		Duplex.call(this, streamOpts);
  }
  SingleConn.create = function (opts) {
    return new SingleConn(opts);
  };

  if (!handlers) { handlers = {}; }
  // XXX TODO
  handlers.onAuthRequest = function (authRequest) {
    // XXX out of scope
    client._wsTunnelRemote._sendCommand('auth', authRequest).catch(function (err) { console.error('1', err); });
  };
  handlers.onAddToken = function (jwtoken) {
    // XXX out of scope
    client._wsTunnelRemote._sendCommand('add_token', jwtoken)
      .catch(function (err) {
        console.error('failed re-adding token', jwtoken, 'after reconnect', err);
        // Not sure if we should do something like remove the token here. It worked
        // once or it shouldn't have stayed in the list, so it's less certain why
        // it would have failed here.
      });
  };
  handlers.onAck = function (body) {
    var packBody = true;
    client._wsTunnelRemote.sendMessage(Packer.packHeader(null, body, 'control', packBody));
  };
  handlers.onNoHandler = function (cmd) {
    console.warn("[telebit] state.handlers['" + cmd[1] + "'] not set");
    console.warn(cmd[2]);
  };
  // TODO
  // make proxy-packer a readable stream?
  // create per-connection buffer?
  handlers.onNonReadable = function (/*fn*/) {
    client.wstunneler.pause();
    //packerHandlers.onReadable = fn;
  };
  handlers.onReadable = function () {
    //packerHandlers.onReadable();
    client.wstunneler.resume();
  };

  var authsent = false;
  function sendAllTokens() {
    if (client.auth) {
      authsent = true;
      handlers.onAuthRequest(client.auth);
    }
    client.sharedTokens.forEach(function (jwtoken) {
      // XXX out of scope
      if (client._state.debug) { console.log('[DEBUG] send token'); }
      authsent = true;
      handlers.onAddToken(jwtoken);
    });
  }

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
      } catch (err) {
        // ignore
      }

      if (!Array.isArray(cmd) || typeof cmd[0] !== 'number') {
        console.warn('received bad command "' + opts.data.toString() + '"');
        return;
      }

      if (cmd[0] < 0) {
        var cb = client.pendingCommands[-cmd[0]];
        if (!cb) {
          console.warn('received response for unknown request:', cmd);
        } else {
          cb.apply(null, cmd.slice(1));
        }
        return;
      }

      if (cmd[0] === 0) {
        console.warn('received dis-associated error from server', cmd[1]);
        if (client.connCallback) {
          client.connCallback(cmd[1]);
        }
        return;
      }

      if (cmd[1] === 'hello') {
        if (client._state.debug) { console.log('[DEBUG] hello received'); }
        sendAllTokens();
        if (client.connCallback) {
          client.connCallback();
        }
        // TODO: handle the versions and commands provided by 'hello' - isn't super important
        // yet since there is only one version and set of commands.
        err = null;
      } else if (cmd[1] === 'grant') {
        client.authenticated = true;
        if (client._state.handlers[cmd[1]]) {
          client._state.handlers[cmd[1]](cmd[2]);
        } else {
          handlers.onNoHandler(cmd);
        }
        return;
      } else if (cmd[1] === 'access_token') {
        client.authenticated = true;
        if (client._state.handlers[cmd[1]]) {
          client._state.handlers[cmd[1]](cmd[2]);
        } else {
          handlers.onNoHandler(cmd);
        }
        return;
      } else {
        err = { message: 'unknown command "'+cmd[1]+'"', code: 'E_UNKNOWN_COMMAND' };
      }

      handlers.onAck([-cmd[0], err]);
    }

  , onconnection: function (tun, handledCb) {
      var cid = tun._id = Packer.addrToId(tun);
      if (multiplexed[cid]) {
        throw new Error("[Sanity Error] a new connection can't already exist in the connection pool");
      }

      // this data should have been gathered already as part of the proxy protocol
      // but if it's available again here we can double check
      hyperPeek(tun);

      // the next data that comes in may be the next packet of data for this connection
      // and that may happen before the detection and assignment is complete
      handlers.onNonReadable(); // pause()
      // TODO use readable streams instead
      require(client._state.sortingHat).assign(client._state, tun, function (err, conn) {
        if (err) {
          err.message = err.message.replace(/:tun_id/, tun._id);
          console.info("[_onConnectError] opening '" + cid + "' failed because " + err.message);
          client._wsTunnelRemote.sendMessage(Packer.packHeader(tun, null, 'error'));
          return;
        }
        //handlers.on
        client.clientHandlers.add(conn, cid, tun);
        if (tun.data) { conn.write(tun.data); }
        handlers.onReadable(); // resume
        if ('function' === typeof handledCb) { handledCb(); }
      });
    }

  , onmessage: function (tun) {
      var cid = tun._id = Packer.addrToId(tun);
      var handled;

      hyperPeek(tun);

      handled = client.clientHandlers.write(cid, tun);

      if (!handled) {
        throw new Error("No 'message' event came before 'connection' event."
          + " You're probably using a different version of proxy-packer on the server than the client");
      }
    }

  , onpause: function (opts) {
      var cid = Packer.addrToId(opts);
      if (client.localclients[cid]) {
        console.log("[TunnelPause] pausing '"+cid+"', remote received", opts.data.toString(), 'of', client.localclients[cid].tunnelWritten, 'sent');
        client.localclients[cid].manualPause = true;
        client.localclients[cid].pause();
      } else {
        console.log('[TunnelPause] remote tried pausing finished connection', cid);
        // Often we have enough latency that we've finished sending before we're told to pause, so
        // don't worry about sending back errors, since we won't be sending data over anyway.
        // var packBody = true;
        // wsTunnelRemote.sendMessage(Packer.packHeader(opts, {message: 'no matching connection', code: 'E_NO_CONN'}, 'error', packBody));
      }
    }
  , onresume: function (opts) {
      var cid = Packer.addrToId(opts);
      if (client.localclients[cid]) {
        console.log("[TunnelResume] resuming '"+cid+"', remote received", opts.data.toString(), 'of', client.localclients[cid].tunnelWritten, 'sent');
        client.localclients[cid].manualPause = false;
        client.localclients[cid].resume();
      } else {
        console.log('[TunnelResume] remote tried resuming finished connection', cid);
        // var packBody = true;
        // wsTunnelRemote.sendMessage(Packer.packHeader(opts, {message: 'no matching connection', code: 'E_NO_CONN'}, 'error', packBody));
      }
    }

  , onend: function (opts) {
      var cid = Packer.addrToId(opts);
      //console.log("[end] '" + cid + "'");
      client.clientHandlers.closeSingle(cid);
    }
  , onerror: function (opts) {
      var cid = Packer.addrToId(opts);
      //console.log("[error] '" + cid + "'", opts.code || '', opts.message);
      client.clientHandlers.closeSingle(cid);
    }
  };


  client.machine = Packer.create(packerHandlers);
  client.sharedTokens = [];

  return client;
};

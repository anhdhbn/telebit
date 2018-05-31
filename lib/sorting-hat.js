module.exports.print = function (config) {
  var services = { https: {}, http: {}, tcp: {} };
  // Note: the remote needs to know:
  //   what servernames to forward
  //   what ports to forward
  //   what udp ports to forward
  //   redirect http to https automatically
  //   redirect www to nowww automatically
  if (config.http) {
    Object.keys(config.http).forEach(function (hostname) {
      if ('*' === hostname) {
        config.servernames.forEach(function (servername) {
          services.https[servername] = config.http[hostname];
          services.http[servername] = 'redirect-https';
        });
        return;
      }
      services.https[hostname] = config.http[hostname];
      services.http[hostname] = 'redirect-https';
    });
  }
  /*
  Object.keys(config.localPorts).forEach(function (port) {
    var proto = config.localPorts[port];
    if (!proto) { return; }
    if ('http' === proto) {
      config.servernames.forEach(function (servername) {
        services.http[servername] = port;
      });
      return;
    }
    if ('https' === proto) {
      config.servernames.forEach(function (servername) {
        services.https[servername] = port;
      });
      return;
    }
    if (true === proto) { proto = 'tcp'; }
    if ('tcp' !== proto) { throw new Error("unsupported protocol '" + proto + "'"); }
  //services[proxy.protocol]['*'] = proxy.port;
  //services[proxy.protocol][proxy.hostname] = proxy.port;
    services[proto]['*'] = port;
  });
  */

  Object.keys(services).forEach(function (protocol) {
    var subServices = services[protocol];
    Object.keys(subServices).forEach(function (hostname) {
      console.info('[local proxy]', protocol + '://' + hostname + ' => ' + subServices[hostname]);
    });
  });
  console.info('');
};

module.exports.assign = function (state, tun, cb) {
  var net = state.net || require('net');

  if (!tun.name && !tun.serviceport) {
    console.log('tun:\n',tun);
    //console.warn(tun.data.toString());
    cb(new Error("No routing information for ':tun_id'. Missing both 'name' and 'serviceport'."));
    return;
  }

  if (!state.config.servernames) {
    state.config.servernames = {};
  }

  var handlers = {};
  handlers.http = function (socket) {
    if (!state.greenlock) {
      state.greenlock = require('greenlock').create(state.greenlockConfig);
    }
    if (!state.httpRedirectServer) {
      state.redirectHttps = require('redirect-https')();
      state.httpRedirectServer = require('http').createServer(state.greenlock.middleware(state.redirectHttps));
    }
    state.httpRedirectServer.emit('connection', socket);
  };
  handlers.https = function (tlsSocket) {
    if (!state.defaultHttpServer) {
      state.defaultHttpServer = require('http').createServer(function (req, res) {
        console.log('[hit http/s server]');
        res.end('Hello, Encrypted Tunnel World!');
      });
    }
    state.defaultHttpServer.emit('connection', tlsSocket);
  };

  if ('http' === tun.service || 'https' === tun.service) {
    if (!tun.name) {
      cb(new Error("No routing information for ':tun_id'. Service '" + tun.service + "' is missing 'name'."));
      return;
    }
  }

  function redirectHttp(cb) {
    var socketPair = require('socket-pair');
    conn = socketPair.create(function (err, other) {
      if (err) { cb(err); return; }
      handlers.http(other);
      cb(null, conn);
    });
    //if (tun.data) { conn.write(tun.data); }
    return conn;
  }

  var handled;

  if ('http' === tun.service) {
    // TODO match *.example.com
    handled = Object.keys(state.config.servernames).some(function (sn) {
      if (sn !== tun.name) { return; }

      console.log('Found config match for PLAIN', tun.name);
      if (!state.config.servernames[sn]) { return; }

      if (false === state.config.servernames[sn].terminate) {
        cb(new Error("insecure http not supported yet"));
        return true;
      }

      console.log('Redirecting HTPTP for', tun.name);
      redirectHttp(cb);
      return true;
    });
    if (!handled) {
      redirectHttp(cb);
    }
    return;
  }

  function terminateTls(cb) {
    var socketPair = require('socket-pair');
    conn = socketPair.create(function (err, other) {
      if (err) { cb(err); return; }

      if (!state.greenlock) {
        state.greenlock = require('greenlock').create(state.greenlockConfig);
      }
      if (!state.terminatorServer) {
        state.terminatorServer = require('tls').createServer(state.greenlock.tlsOptions, function (tlsSocket) {
          console.log('[hit tls server]');
          if (err) { cb(err); return; }
          handlers.https(tlsSocket);
        });
      }

      console.log('[emitting tls connection]');
      state.terminatorServer.emit('connection', other);
      cb(null, conn);
    });
    //if (tun.data) { conn.write(tun.data); }
    return conn;
  }

  if ('https' === tun.service) {
    // TODO match *.example.com
    handled = Object.keys(state.config.servernames).some(function (sn) {
      if (sn !== tun.name) { return; }

      console.log('Found config match for TLS', tun.name);
      if (!state.config.servernames[sn]) { return; }

      if (false === state.config.servernames[sn].terminate) {
        cb(new Error("insecure http not supported yet"));
        return true;
      }

      console.log('Terminating TLS for', tun.name);
      terminateTls(cb);
      return true;
    });
    if (!handled) {
      terminateTls(cb);
    }
    return;
  }

  return;
  var portList = state.services[service];
  var port;
  port = portList[tun.name];
  if (!port) {
    // Check for any wildcard domains, sorted longest to shortest so the one with the
    // biggest natural match will be found first.
    Object.keys(portList).filter(function (pattern) {
      return pattern[0] === '*' && pattern.length > 1;
    }).sort(function (a, b) {
      return b.length - a.length;
    }).some(function (pattern) {
      var subPiece = pattern.slice(1);
      if (subPiece === tun.name.slice(-subPiece.length)) {
        port = portList[pattern];
        return true;
      }
    });
  }
  if (!port) {
    port = portList['*'];
  }

  var createOpts = {
    port: port
  , host: '127.0.0.1'

  , servername: tun.name
  , name: tun.name
  , serviceport: tun.serviceport
  , data: tun.data
  , remoteFamily: tun.family
  , remoteAddress: tun.address
  , remotePort: tun.port
  };
  var conn;

  function handleNow(socket) {
    var httpServer;
    var tlsServer;
    if ('https' === tun.service) {
      if (!state.greenlock) {
        state.greenlock = require('greenlock').create(state.greenlockConfig);
      }
      httpServer = require('http').createServer(function (req, res) {
        console.log('[hit http/s server]');
        res.end('Hello, Encrypted Tunnel World!');
      });
      tlsServer = require('tls').createServer(state.greenlock.tlsOptions, function (tlsSocket) {
        console.log('[hit tls server]');
        httpServer.emit('connection', tlsSocket);
      });
      tlsServer.emit('connection', socket);
    } else {
      httpServer = require('http').createServer(state.greenlock.middleware(function (req, res) {
        console.log('[hit pure http server]');
        res.end('Hello, Encrypted Tunnel World!');
      }));
      // http://aj.telebit.cloud/.well-known/acme-challenge/blah
      httpServer.emit('connection', socket);
    }
  }
  if ('aj.telebit.cloud' === tun.name) {
    console.log('NEW CONNECTION to AJ\'s telebit could');
    // For performance it may be better to use socket-pair, needs testing
    var socketPair = require('socket-pair');
    conn = socketPair.create(function (err, other) {
      if (err) { console.error('[Error] ' + err.message); }
      handleNow(other);
      //if (createOpts.data) { conn.write(createOpts.data); }
    });
    /*
    var streamPair = require('stream-pair');
    var pair = streamPair.create();
    conn = pair.other;
    process.nextTick(function () {
      if (createOpts.data) {
        conn.write(createOpts.data);
      }
    });
    */
  } else {
    conn = net.createConnection(createOpts, function () {
      // this will happen before 'data' or 'readable' is triggered
      // We use the data from the createOpts object so that the createConnection function has
      // the oppurtunity of removing/changing it if it wants/needs to handle it differently.
      //if (createOpts.data) { conn.write(createOpts.data); }
    });
  }
  cb(null, conn);
};

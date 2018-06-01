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
  console.log('first message from', tun);
  var net = state.net || require('net');

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
    console.log('Enccrypted', tlsSocket.encrypted, tlsSocket.remoteAddress, tlsSocket.remotePort);
    if (!state.defaultHttpServer) {
      state.defaultHttpServer = require('http').createServer(function (req, res) {
        console.log('[hit http/s server]');
        res.end('Hello, Encrypted Tunnel World!');
      });
    }
    state.defaultHttpServer.emit('connection', tlsSocket);
  };

  function getNetConn(port) {
    var netOpts = {
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
    var conn = net.createConnection(netOpts, function () {
      // this will happen before 'data' or 'readable' is triggered
      // We use the data from the netOpts object so that the createConnection function has
      // the oppurtunity of removing/changing it if it wants/needs to handle it differently.
    });
    return conn;
  }

  function redirectHttp(cb) {
    var socketPair = require('socket-pair');
    var conn = socketPair.create(function (err, other) {
      if (err) { cb(err); return; }
      handlers.http(other);
      cb(null, conn);
    });
    //if (tun.data) { conn.write(tun.data); }
    return conn;
  }

  function defineProps(other, tun) {
    Object.defineProperty(other, 'remoteFamily', {
      enumerable: false,
      configurable: true,
      get: function() {
        return tun.family;
      }
    });
    Object.defineProperty(other, 'remoteAddress', {
      enumerable: false,
      configurable: true,
      get: function() {
        return tun.address;
      }
    });
    Object.defineProperty(other, 'remotePort', {
      enumerable: false,
      configurable: true,
      get: function() {
        return parseInt(tun.port);
      }
    });
    Object.defineProperty(other, 'localPort', {
      enumerable: false,
      configurable: true,
      get: function() {
        return parseInt(tun.serviceport);
      }
    });
  }

  function invokeHandler(conf, tlsSocket, tun, id) {
    if (parseInt(conf.handler, 10)) {
      // TODO http-proxy with proper headers and ws support
      var conn = getNetConn(conf.handler);
      console.info("Port-Forwarding '" + (tun.name || tun.serviceport) + "' to '" + conf.handler + "'");
      conn.pipe(tlsSocket);
      tlsSocket.pipe(conn);
      return;
    }
    var handle = tun.name || tun.port;
    var handler;
    var path = require('path');
    var homedir = require('os').homedir();
    var localshare = path.join(homedir, '.local/share/telebit/apps');

    if (/^~/.test(conf.handler)) {
      conf.handler = require('path').join(require('os').homedir(), conf.handler.replace(/^~(\/?)/, ''));
    }

    try {
      handler = require(conf.handler);
      console.info("Handling '" + handle + ":" + id + "' with '" + conf.handler + "'");
      handler(tlsSocket, tun, id);
    } catch(e1) {
      try {
        handler = require(path.join(localshare, conf.handler));
        console.info("Handling '" + handle + ":" + id + "' with '" + conf.handler + "'");
        handler(tlsSocket, tun, id);
      } catch(e2) {
        console.error("Failed to load '" + conf.handler + "':", e1.message);
        console.error("Failed to load '" + path.join(localshare, conf.handler) + "':", e2.message);
        console.warn("Using default handler for '" + handle + ":" + id + "'");
        handlers.https(tlsSocket, tun, id);
      }
    }
  }

  function terminateTls(tun, cb) {
    var socketPair = require('socket-pair');
    var conn = socketPair.create(function (err, other) {
      if (err) { cb(err); return; }

      //console.log('[hit tcp connection]', other.remoteFamily, other.remoteAddress, other.remotePort, other.localPort);
      defineProps(other, tun);
      //console.log('[hit tcp connection]', other.remoteFamily, other.remoteAddress, other.remotePort, other.localPort);

      if (!state.greenlock) {
        state.greenlock = require('greenlock').create(state.greenlockConfig);
      }

      if (!state.terminatorServer) {
        state.terminatorServer = require('tls').createServer(state.greenlock.tlsOptions, function (tlsSocket) {
          var Packer = require('proxy-packer');
          var addr = Packer.socketToAddr(tlsSocket);
          var id = Packer.addrToId(addr);

          defineProps(tlsSocket, addr);
          //console.log('[hit tls server]', tlsSocket.remoteFamily, tlsSocket.remoteAddress, tlsSocket.remotePort, tlsSocket.localPort);
          //console.log(addr);
          var conf = state.config.servernames[tlsSocket.servername];
          if (!conf || !conf.handler) {
            handlers.https(tlsSocket);
            return;
          }
          invokeHandler(conf, tlsSocket, tun, id);
        });
      }

      //console.log('[hit tcp connection]', other.remoteFamily, other.remoteAddress, other.remotePort, other.localPort);
      state.terminatorServer.emit('connection', other);
      cb(null, conn);
    });
    //if (tun.data) { conn.write(tun.data); }
    return conn;
  }

  var handled;

  if (!tun.name && !tun.serviceport) {
    console.log('tun:\n',tun);
    //console.warn(tun.data.toString());
    cb(new Error("No routing information for ':tun_id'. Missing both 'name' and 'serviceport'."));
    return;
  }

  if (!state.config.servernames) {
    state.config.servernames = {};
  }


  if ('http' === tun.service || 'https' === tun.service) {
    if (!tun.name) {
      cb(new Error("No routing information for ':tun_id'. Service '" + tun.service + "' is missing 'name'."));
      return;
    }
  }

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
      terminateTls(tun, cb);
      return true;
    });
    if (!handled) {
      terminateTls(tun, cb);
    }
    return;
  }

  function trySsh(tun) {
    // https://security.stackexchange.com/questions/43231/plausibly-deniable-ssh-does-it-make-sense?rq=1
    // https://tools.ietf.org/html/rfc4253#section-4.2
    if ('SSH-2.0-' !== tun.data.slice(0, 8).toString()) {
      return false;
    }
    cb(null, getNetConn(state.config.sshPort || 22));
    return true;
  }

  if ('tcp' === tun.service) {
    if (trySsh(tun)) { return; }
    cb(new Error("No TCP handler"));
  }

  console.warn("Unknown service '" + tun.service + "'");

  /*
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
  */
};

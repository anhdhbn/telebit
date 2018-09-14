'use strict';

var os = require('os');
var path = require('path');
var fs = require('fs');

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
  //console.log('first message from', tun);
  var net = state.net || require('net');

  function trySsh(tun, cb) {
    // https://security.stackexchange.com/questions/43231/plausibly-deniable-ssh-does-it-make-sense?rq=1
    // https://tools.ietf.org/html/rfc4253#section-4.2
    var sshPort;
    if (-1 !== ['true', 'enable', 'auto', 'on'].indexOf(state.config.sshAuto)) {
      sshPort = 22;
    } else {
      sshPort = parseInt(state.config.sshAuto, 10);
    }
    if (!sshPort || 'SSH-2.0-' !== tun.data.slice(0, 8).toString()) {
      cb(null, false);
      return;
    }
    getNetConn(sshPort, cb);
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
    process.nextTick(function () { socket.resume(); });
  };
  handlers.https = function (tlsSocket) {
    console.log('Encrypted', tlsSocket.encrypted, tlsSocket.remoteAddress, tlsSocket.remotePort);
    if (!state.defaultHttpServer) {
      state._finalHandler = require('finalhandler');
      state._serveStatic = require('serve-static');
      state._defaultServe = state._serveStatic(path.join(__dirname, 'html'));
      state.defaultHttpServer = require('http').createServer(function (req, res) {
        // TODO serve api
        state._defaultServe(req, res, state._finalHandler(req, res));
      });
    }
    state.defaultHttpServer.emit('connection', tlsSocket);
    process.nextTick(function () { tlsSocket.resume(); });
  };

  function getNetConn(port, cb) {
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
      cb(null, conn);
      cb = function () {}; // for error events
    });
    conn.on('error', function (err) {
      cb(err);
    });
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

  function errorTcp(conf, cb) {
    var socketPair = require('socket-pair');
    var conn = socketPair.create(function (err, other) {
      if (err) { cb(err); return; }

      cb(null, conn);

      other.write("\n" +
      [ "[Telebit Error Server]"
      , "Could not load '" + conf.handler + "' as a module, file, or directory."
      ].join("\n") + "\n\n");
      other.end();
    });
    //if (tun.data) { conn.write(tun.data); }
    return conn;
  }
  function fileDirTcp(opts, cb) {
    var socketPair = require('socket-pair');
    var conn = socketPair.create(function (err, other) {
      if (err) { cb(err); return; }

      if (opts.stat.isFile()) {
        fs.createReadStream(opts.config.handler).pipe(other);
      } else {
        fs.readdir(opts.config.handler, function (err, nodes) {
          other.write('\n' + nodes.join('\n') + '\n\n');
          other.end();
        });
      }
      cb(null, conn);
    });
    //if (tun.data) { conn.write(tun.data); }
    return conn;
  }
  function echoTcp(cb) {
    var socketPair = require('socket-pair');
    var conn = socketPair.create(function (err, other) {
      if (err) { cb(err); return; }

      other.on('data', function (chunk) {
        other.write(chunk);
      });

      other.on('end', function () {
        other.end();
      });

      cb(null, conn);

      other.write("\n" +
      [ "[Telebit Echo Server] v1.0"
      , "To configure tcp run the following:"
      , "\ttelebit tcp <port number or module name>"
      , "\tex: telebit tcp 5050"
      , "\tex: telebit tcp /path/to/module"
      , "\tex: telebit tcp none"
      ].join("\n") + "\n\n");
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

  function invokeTcpHandler(conf, socket, tun, id, cb) {
    var conn;
    if (parseInt(conf.handler, 10)) {
      getNetConn(conf.handler, cb);
      return conn;
    }

    var handle = tun.port;
    var handler;
    var handlerpath = conf.handler;
    var homedir = os.homedir();
    var localshare = path.join(homedir, '.local/share/telebit/apps');

    if (/^~/.test(handlerpath)) {
      handlerpath = path.join(homedir, handlerpath.replace(/^~(\/?)/, ''));
    }

    try {
      handler = require(handlerpath);
      console.info("Handling '" + handle + ":" + id + "' with '" + handlerpath + "'");
    } catch(e1) {
      try {
        handler = require(path.join(localshare, handlerpath));
        console.info("Handling '" + handle + ":" + id + "' with '" + handlerpath + "'");
      } catch(e2) {
        console.error("Failed to require('" + handlerpath + "'):", e1.message);
        console.error("Failed to require('" + path.join(localshare, handlerpath) + "'):", e2.message);
        console.warn("Trying static and index handlers for '" + handle + ":" + id + "'");
        handler = null;
        // fallthru
      }
    }

    if (handler) {
      var socketPair = require('socket-pair');
      conn = socketPair.create(function (err, other) {
        handler(other, tun, id);
        cb(null, conn);
      });
      return conn;
    }

    fs.access(conf.handler, fs.constants.R_OK, function (err1) {
      fs.stat(conf.handler, function (err2, stat) {
        if ((err1 || err2) || !(stat.isFile() || stat.isDirectory())) {
          errorTcp(conf, cb);
          return;
        }
        fileDirTcp({ config: conf, stat: stat }, cb);
      });
    });
  }
  var handlerservers = {};
  function invokeHandler(conf, tlsSocket, tun, id) {
    if (parseInt(conf.handler, 10)) {
      // TODO http-proxy with proper headers and ws support
      getNetConn(conf.handler, function (err, conn) {
        process.nextTick(function () { tlsSocket.resume(); });
        if (err) {
          require('./handlers/local-app-error.js')({ handler: conf.handler, socket: tlsSocket });
          return;
        }
        console.info("Port-Forwarding '" + (tun.name || tun.serviceport) + "' to '" + conf.handler + "'");
        conn.pipe(tlsSocket);
        tlsSocket.pipe(conn);
      });
      return;
    }
    var handle = tun.name || tun.port;
    var handler;
    var handlerpath = conf.handler;
    var homedir = os.homedir();
    var localshare = path.join(homedir, '.local/share/telebit/apps');
    var http = require('http');

    // 1. No modification handlerpath may be an aboslute path
    // 2. it may be relative to a user home directory
    // 3. it may be relative to a user ~/local/share

    tlsSocket._tun = tun;
    tlsSocket._id = id;
    if (handlerservers[conf.handler]) {
      handlerservers[conf.handler].emit('connection', tlsSocket);
      process.nextTick(function () { tlsSocket.resume(); });
      return;
    }

    if (/^~/.test(handlerpath)) {
      // TODO have the telebit remote tell which user is running
      handlerpath = path.join(homedir, handlerpath.replace(/^~(\/?)/, ''));
    }

    try {
      handler = require(handlerpath);
      console.info("Trying to handle '" + handle + ":" + id + "' with '" + handlerpath + "'");
    } catch(e1) {
      try {
        handler = require(path.join(localshare, handlerpath));
        console.info("Skip. (couldn't require('" + handlerpath + "'):", e1.message + ")");
        console.info("Trying to handle '" + handle + ":" + id + "' with '" + handlerpath + "'");
      } catch(e2) {
        console.info("Skip. (couldn't require('" + path.join(localshare, handlerpath) + "'):", e2.message + ")");
        console.info("Last chance! (using static and index handlers for '" + handle + ":" + id + "')");
        handler = null;
        // fallthru
      }
    }

    if (handler) {
      handlerservers[conf.handler] = http.createServer(handler);
      handlerservers[conf.handler].emit('connection', tlsSocket);
      process.nextTick(function () { tlsSocket.resume(); });
      return;
    }

    fs.access(conf.handler, fs.constants.R_OK, function (err1) {
      fs.stat(conf.handler, function (err2, stat) {
        if (err1 || err2) {
          // TODO handle errors
          handlers.https(tlsSocket, tun, id);
          return;
        }
        var isFile = stat.isFile();
        state._finalHandler = require('finalhandler');
        state._serveStatic = require('serve-static');
        state._serveIndex = require('serve-index');
        var serveIndex;
        var serveStatic;
        var dlStatic;
        if (isFile) {
          serveStatic = state._serveStatic(path.dirname(conf.handler), { dotfiles: 'allow', index: [ 'index.html' ] });
          dlStatic = state._serveStatic(path.dirname(conf.handler), { acceptRanges: false, dotfiles: 'allow', index: [ 'index.html' ] });
          serveIndex = function (req, res, next) { next(); };
          isFile = path.basename(conf.handler);
        } else {
          serveStatic = state._serveStatic(conf.handler, { dotfiles: 'allow', index: [ 'index.html' ] });
          dlStatic = state._serveStatic(conf.handler, { acceptRanges: false, dotfiles: 'allow', index: [ 'index.html' ] });
          serveIndex = state._serveIndex(conf.handler, {
            hidden: true, icons: true
          , template: require('serve-tpl-attachment')({ privatefiles: 'ignore' })
          });
        }
        handler = function (req, res) {
          var qIndex = req.url.indexOf('?');
          var fIndex;
          var fname;
          if (-1 === qIndex) {
            qIndex = req.url.length;
          }
          req.querystring = req.url.substr(qIndex);
          req.url = req.url.substr(0, qIndex);
          req.query = require('querystring').parse(req.querystring.substr(1));
          if (isFile) {
            req.url = '/' + isFile;
          }
          //console.log('[req.query]', req.url, req.query);
          if (req.query.download) {
            fIndex = req.url.lastIndexOf('/');
            fname = req.url.substr(fIndex + 1);
            res.setHeader('Content-Disposition', 'attachment; filename="'+decodeURIComponent(fname)+'"');
            res.setHeader('Content-Type', 'application/octet-stream');
            dlStatic(req, res, function () {
              serveIndex(req, res, state._finalHandler(req, res));
            });
          } else {
            serveStatic(req, res, function () {
              serveIndex(req, res, state._finalHandler(req, res));
            });
          }
        };
        handlerservers[conf.handler] = http.createServer(handler);
        handlerservers[conf.handler].emit('connection', tlsSocket);
        process.nextTick(function () { tlsSocket.resume(); });
      });
    });
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
          var conf = state.servernames[tlsSocket.servername];
          tlsSocket.once('data', function (firstChunk) {
            tlsSocket.pause();
            //tlsSocket.unshift(firstChunk);
            tlsSocket._handle.onread(firstChunk.length, firstChunk);

            trySsh({ data: firstChunk }, function (err, conn) {
              if (conn) {
                conn.pipe(tlsSocket);
                tlsSocket.pipe(conn);
                return;
              }

              if (!conf || !conf.handler || 'none' === conf.handler) {
                console.log('https default handler');
                handlers.https(tlsSocket);
                return;
              }

              //console.log('https invokeHandler');
              invokeHandler(conf, tlsSocket, tun, id);
            });
          });
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

  if ('http' === tun.service || 'https' === tun.service) {
    if (!tun.name) {
      cb(new Error("No routing information for ':tun_id'. Service '" + tun.service + "' is missing 'name'."));
      return;
    }
  }

  if ('http' === tun.service) {
    // TODO match *.example.com
    handled = Object.keys(state.servernames).some(function (sn) {
      if (sn !== tun.name) { return; }

      console.log('Found config match for PLAIN', tun.name);
      if (!state.servernames[sn]) { return; }

      if (false === state.servernames[sn].terminate) {
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
    handled = Object.keys(state.servernames).some(function (sn) {
      if (sn !== tun.name) { return; }

      console.log('Found config match for TLS', tun.name);
      if (!state.servernames[sn]) { return; }

      if (false === state.servernames[sn].terminate) {
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

  if ('tcp' === tun.service) {
    trySsh(tun, function (err, conn) {
      if (conn) { cb(null, conn); return; }
      // TODO add TCP handlers
      var conf = state.ports[tun.serviceport];
      if (!conf || !conf.handler || 'none' === conf.handler) {
        console.log('Using echo server for tcp');
        echoTcp(cb);
        return;
      }

      var Packer = require('proxy-packer');
      //var addr = Packer.socketToAddr(conn);
      var id = Packer.addrToId(tun);
      invokeTcpHandler(conf, conn, tun, id, cb);
    });
    return;
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

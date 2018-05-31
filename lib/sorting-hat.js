module.exports.assign = function (state, tun, cb) {
  var net = state.net || require('net');
  var service = tun.service.toLowerCase();
  var portList = state.services[service];
  var port;

  if (!tun.name && !tun.serviceport) {
    console.log('tun:\n',tun);
    //console.warn(tun.data.toString());
    cb(new Error("missing routing information for ':tun_id'"));
    return;
  }

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
    if ('https' === service) {
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
      if (createOpts.data) {
        conn.write(createOpts.data);
      }
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
      if (createOpts.data) {
        conn.write(createOpts.data);
      }
    });
  }
  cb(null, conn);
};

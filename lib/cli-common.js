'use strict';

var common = module.exports;

var path = require('path');
var url = require('url');
var mkdirp = require('mkdirp');
var os = require('os');
var homedir = os.homedir();
var urequest = require('@coolaj86/urequest');

var localshare = '.local/share/telebit';
var localconf = '.config/telebit';

common.pipename = function (config, newApi) {
  var _ipc = {
    path: (config.sock || common.DEFAULT_SOCK_NAME)
  , comment: (/^win/i.test(os.platform()) ? 'windows pipe' : 'unix socket')
  , type: (/^win/i.test(os.platform()) ? 'pipe' : 'socket')
  };
  if ('pipe' === _ipc.type) {
    _ipc.path = '\\\\?\\pipe' + _ipc.path.replace(/\//, '\\');
  }
  if (newApi) {
    return _ipc;
  }
  return _ipc.path;
};
common.DEFAULT_SOCK_NAME = path.join(homedir, localshare, 'var', 'run', 'telebit.sock');

common.parseUrl = function (hostname) {
  var location = url.parse(hostname);
  if (!location.protocol || /\./.test(location.protocol)) {
    hostname = 'https://' + hostname;
    location = url.parse(hostname);
  }
  hostname = location.hostname + (location.port ? ':' + location.port : '');
  hostname = location.protocol.replace(/https?/, 'https') + '//' + hostname + location.pathname;
  return hostname;
};
common.parseHostname = function (hostname) {
  var location = url.parse(hostname);
  if (!location.protocol || /\./.test(location.protocol)) {
    hostname = 'https://' + hostname;
    location = url.parse(hostname);
  }
  //hostname = location.hostname + (location.port ? ':' + location.port : '');
  //hostname = location.protocol.replace(/https?/, 'https') + '//' + hostname + location.pathname;
  return location.hostname;
};

common.apiDirectory = '_apis/telebit.cloud/index.json';

common.otp = function getOtp() {
  return Math.round(Math.random() * 9999).toString().padStart(4, '0');
};
common.api = {};
common.api.directory = function (state, next) {
  state.relayUrl = common.parseUrl(state.relay);
  urequest({ url: state.relayUrl + common.apiDirectory, json: true }, function (err, resp, body) {
    next(err, body);
  });
};
common.api.token = function (state, handlers) {
  common.api.directory(state, function (err, dir) {
    // directory, requested, connect, tunnelUrl, offer, granted, end
    function afterDir() {
      //console.log('[debug] after dir');
      state.relayHostname = common.parseHostname(state.relay);
      state.wss = dir.tunnel.method + '://' + dir.api_host.replace(/:hostname/g, state.relayHostname) + dir.tunnel.pathname;

      handlers.tunnelUrl(state.wss, function () {
        //console.log('[debug] after tunnelUrl');
        if (!state.config.token && state.config.secret) {
          var jwt = require('jsonwebtoken');
          var tokenData = {
            domains: Object.keys(state.config.servernames || {}).filter(function (name) {
              return /\./.test(name);
            })
          , ports: Object.keys(state.config.ports || {}).filter(function (port) {
              port = parseInt(port, 10);
              return port > 0 && port <= 65535;
            })
          , aud: state.relayUrl
          , iss: Math.round(Date.now() / 1000)
          };

          state.token = jwt.sign(tokenData, state.config.secret);
        }
        state.token = state.token || state.config.token;
        if (state.token) {
          //console.log('[debug] token via token or secret');
          handlers.connect(state.token, function () {
            handlers.end(null, function () {});
          });
          return;
        }

        // backwards compat (TODO remove)
        if (err || !dir || !dir.pair_request) {
          //console.log('[debug] no dir, connect');
          handlers.error(new Error("No token found or generated, and no pair_request api found."));
          return;
        }
        
        // TODO sign token with own private key, including public key and thumbprint
        //      (much like ACME JOSE account)
        var otp = state.otp || state._otp || common.otp();
        var authReq = state.authRequest || state._auth || {
          subject: state.config.email
        , subject_scheme: 'mailto'
          // TODO create domains list earlier
        , scope: Object.keys(state.config.servernames || {})
            .concat(Object.keys(state.config.ports || {})).join(',')
        , otp: otp
        , hostname: os.hostname()
          // Used for User-Agent
        , os_type: os.type()
        , os_platform: os.platform()
        , os_release: os.release()
        , os_arch: os.arch()
        };
        var pairRequestUrl = url.resolve('https://' + dir.api_host.replace(/:hostname/g, state.relayHostname), dir.pair_request.pathname);
        var req = {
          url: pairRequestUrl
        , method: dir.pair_request.method
        , json: authReq
        };
        var firstReq = true;
        var firstReady = true;

        function gotoNext(req) {
          //console.log('[debug] gotoNext called');
          urequest(req, function (err, resp, body) {
            if (err) {
              //console.log('[debug] gotoNext error');
              err._request = req;
              err._hint = '[telebitd.js] pair request';
              handlers.error(err, function () {});
              return;
            }

            function checkLocation() {
              //console.log('[debug] checkLocation');
              // pending, try again
              if ('pending' === body.status && resp.headers.location) {
                //console.log('[debug] pending');
                setTimeout(gotoNext, 2 * 1000, { url: resp.headers.location, json: true });
                return;
              }

              if ('ready' === body.status) {
                //console.log('[debug] ready');
                if (firstReady) {
                  //console.log('[debug] first ready');
                  firstReady = false;
                  state.token = body.access_token;
                  state.config.token = state.token;
                  handlers.offer(body.access_token, function () {
                    /*ignore*/
                  });
                }
                setTimeout(gotoNext, 2 * 1000, req);
                return;
              }

              if ('complete' === body.status) {
                //console.log('[debug] complete');
                handlers.granted(null, function () {
                  handlers.end(null, function () {});
                });
                return;
              }

              //console.log('[debug] bad status');
              var err = new Error("Bad State:" + body.status);
              err._request = req;
              handlers.error(err, function () {});
            }

            if (firstReq) {
              //console.log('[debug] first req');
              handlers.requested(authReq, function () {
                handlers.connect(body.access_token || body.jwt, function () {
                  setTimeout(gotoNext, 2 * 1000, { url: resp.headers.location, json: true });
                });
              });
              firstReq = false;
              return;
            } else {
              //console.log('[debug] other req');
              checkLocation();
            }
          });
        }

        gotoNext(req);

      });
    }

    if (dir) {
      handlers.directory(dir, afterDir);
    } else {
      // backwards compat
      dir = { api_host: ':hostname', tunnel: { method: "wss", pathname: "" } };
      afterDir();
    }
  });

};

try {
  mkdirp.sync(path.join(__dirname, '..', 'var', 'log'));
  mkdirp.sync(path.join(__dirname, '..', 'var', 'run'));
  mkdirp.sync(path.join(__dirname, '..', 'etc'));
} catch(e) {
  console.error(e);
}

try {
  mkdirp.sync(path.join(homedir, localshare, 'var', 'log'));
  mkdirp.sync(path.join(homedir, localshare, 'var', 'run'));
  //mkdirp.sync(path.join(homedir, localshare, 'etc'));
  mkdirp.sync(path.join(homedir, localconf));
} catch(e) {
  console.error(e);
}

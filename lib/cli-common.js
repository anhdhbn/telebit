'use strict';

module.exports.debug = (-1 !== (process.env.NODE_DEBUG||'').split(/\s+/g).indexOf('telebit'));
var common = module.exports;

var path = require('path');
var url = require('url');
var fs = require('fs');
var mkdirp = require('mkdirp');
var os = require('os');
var homedir = os.homedir();
var urequest = require('@coolaj86/urequest');

common._NOTIFICATIONS = {
  'newsletter': [ 'newsletter', 'communityMember' ]
, 'important': [ 'communityMember' ]
};
common.CONFIG_KEYS = [
  'newsletter'
, 'communityMember'
, 'telemetry'
, 'sshAuto'
, 'email'
, 'agreeTos'
, 'relay'
, 'token'
, 'pretoken'
, 'secret'
];
//, '_servernames' // list instead of object
//, '_ports'       // list instead of object
//, '_otp'         // otp should not be saved
//, '_token'       // temporary token

common.getPort = function (config, cb) {
  var portfile = path.resolve(config.sock || common.DEFAULT_SOCK_PATH, '..', 'telebit.port');
  if (cb) {
    return fs.readFile(portfile, 'utf8', function (err, text) {
      cb(err, parseInt((text||'').trim(), 10) || null);
    });
  } else {
    try {
      return parseInt(fs.readFileSync(portfile, 'utf8').trim(), 10) || null;
    } catch(e) {
      return null;
    }
  }
};
common.setPort = function (config, num, cb) {
  var portfile = path.resolve(config.sock || common.DEFAULT_SOCK_PATH, '..', 'telebit.port');
  var numstr = (num || '').toString();
  if (cb) {
    return fs.writeFile(portfile, numstr, 'utf8', function (err) {
      cb(err);
    });
  } else {
    try {
      return fs.writeFileSync(portfile, numstr, 'utf8');
    } catch(e) {
      return null;
    }
  }
};
common.removePort = function (config, cb) {
  var portfile = path.resolve(config.sock || common.DEFAULT_SOCK_PATH, '..', 'telebit.port');
  if (cb) {
    return fs.unlink(portfile, function (err, text) {
      cb(err, (text||'').trim());
    });
  } else {
    try {
      return fs.unlinkSync(portfile);
    } catch(e) {
      return null;
    }
  }
};
common.pipename = function (config) {
  var _ipc = {
    path: (config.sock || common.DEFAULT_SOCK_PATH)
  , comment: (/^win/i.test(os.platform()) ? 'windows pipe' : 'unix socket')
  , type: (/^win/i.test(os.platform()) ? 'pipe' : 'socket')
  };
  if ('pipe' === _ipc.type) {
    // https://docs.microsoft.com/en-us/windows/desktop/ipc/pipe-names
    // Allows all characters accept backslash as part of the name
    _ipc.path = '\\\\.\\pipe\\' + _ipc.path.replace(/\\/g, '/');
  }
  return _ipc;
};
common.DEFAULT_SOCK_PATH = path.join(homedir, '.local/share/telebit/var/run', 'telebit.sock');
common.DEFAULT_CONFIG_PATH = path.join(homedir, '.config/telebit', 'telebitd.yml');

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
common.signToken = function (state) {
  var jwt = require('jsonwebtoken');
  var tokenData = {
    domains: Object.keys(state.config.servernames || {}).filter(function (name) {
      return /\./.test(name);
    })
  , ports: Object.keys(state.config.ports || {}).filter(function (port) {
      port = parseInt(port, 10);
      return port > 0 && port <= 65535;
    })
  , aud: state._relayUrl
  , iss: Math.round(Date.now() / 1000)
  };

  return jwt.sign(tokenData, state.config.secret);
};
common.api = {};
common.api.directory = function (state, next) {
  state._relayUrl = common.parseUrl(state.relay);
  urequest({ url: state._relayUrl + common.apiDirectory, json: true }, function (err, resp, dir) {
    if (!dir) { dir = { api_host: ':hostname', tunnel: { method: "wss", pathname: "" } }; }
    state._apiDirectory = dir;
    next(err, dir);
  });
};
common.api._parseWss = function (state, dir) {
  if (!dir || !dir.api_host) {
    dir = { api_host: ':hostname', tunnel: { method: "wss", pathname: "" } };
  }
  state._relayHostname = common.parseHostname(state.relay);
  return dir.tunnel.method + '://' + dir.api_host.replace(/:hostname/g, state._relayHostname) + dir.tunnel.pathname;
};
common.api.wss = function (state, cb) {
  common.api.directory(state, function (err, dir) {
    cb(err, common.api._parseWss(state, dir));
  });
};
common.api.token = function (state, handlers) {
  common.api.directory(state, function (err, dir) {
    // directory, requested, connect, tunnelUrl, offer, granted, end
    function afterDir() {
      if (common.debug) { console.log('[debug] after dir'); }
      state.wss = common.api._parseWss(state, dir);

      handlers.tunnelUrl(state.wss, function () {
        if (common.debug) { console.log('[debug] after tunnelUrl'); }
        if (state.config.secret /* && !state.config.token */) {
          state.config._token = common.signToken(state);
        }
        state.token = state.token || state.config.token || state.config._token;
        if (state.token) {
          if (common.debug) { console.log('[debug] token via token or secret'); }
          // { token, pretoken }
          handlers.connect(state.token, function () {
            handlers.end(null, function () {});
          });
          return;
        }

        // backwards compat (TODO remove)
        if (err || !dir || !dir.pair_request) {
          if (common.debug) { console.log('[debug] no dir, connect'); }
          handlers.error(new Error("No token found or generated, and no pair_request api found."));
          return;
        }

        // TODO sign token with own private key, including public key and thumbprint
        //      (much like ACME JOSE account)
        var otp = state.config._otp; // common.otp();
        var authReq = {
          subject: state.config.email
        , subject_scheme: 'mailto'
          // TODO create domains list earlier
        , scope: (state.config._servernames || Object.keys(state.config.servernames || {}))
            .concat(state.config._ports || Object.keys(state.config.ports || {})).join(',')
        , otp: otp
        , hostname: os.hostname()
          // Used for User-Agent
        , os_type: os.type()
        , os_platform: os.platform()
        , os_release: os.release()
        , os_arch: os.arch()
        };
        var pairRequestUrl = url.resolve('https://' + dir.api_host.replace(/:hostname/g, state._relayHostname), dir.pair_request.pathname);
        var req = {
          url: pairRequestUrl
        , method: dir.pair_request.method
        , json: authReq
        };
        var firstReq = true;
        var firstReady = true;

        function gotoNext(req) {
          if (common.debug) { console.log('[debug] gotoNext called'); }
          if (common.debug) { console.log(req); }
          urequest(req, function (err, resp, body) {
            if (err) {
              if (common.debug) { console.log('[debug] gotoNext error'); }
              err._request = req;
              err._hint = '[telebitd.js] pair request';
              handlers.error(err, function () {});
              return;
            }

            function checkLocation() {
              if (common.debug) { console.log('[debug] checkLocation'); }
              if (common.debug) { console.log(body); }
              // pending, try again
              if ('pending' === body.status && resp.headers.location) {
                if (common.debug) { console.log('[debug] pending'); }
                setTimeout(gotoNext, 2 * 1000, { url: resp.headers.location, json: true });
                return;
              }

              if ('ready' === body.status) {
                if (common.debug) { console.log('[debug] ready'); }
                if (firstReady) {
                  if (common.debug) { console.log('[debug] first ready'); }
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
                if (common.debug) { console.log('[debug] complete'); }
                handlers.granted(null, function () {
                  handlers.end(null, function () {});
                });
                return;
              }

              if (common.debug) { console.log('[debug] bad status'); }
              var err = new Error("Bad State:" + body.status);
              err._request = req;
              handlers.error(err, function () {});
            }

            if (firstReq) {
              if (common.debug) { console.log('[debug] first req'); }
              handlers.requested(authReq, function () {
                handlers.connect(body.access_token || body.jwt, function () {
                  var err;
                  if (!resp.headers.location) {
                    err = new Error("bad authentication request response");
                    err._resp = resp.toJSON();
                    handlers.error(err, function () {});
                    return;
                  }
                  setTimeout(gotoNext, 2 * 1000, { url: resp.headers.location, json: true });
                });
              });
              firstReq = false;
              return;
            } else {
              if (common.debug) { console.log('[debug] other req'); }
              checkLocation();
            }
          });
        }

        gotoNext(req);

      });
    }

    if (dir && dir.api_host) {
      handlers.directory(dir, afterDir);
    } else {
      // backwards compat
      dir = { api_host: ':hostname', tunnel: { method: "wss", pathname: "" } };
      afterDir();
    }
  });

};

common._init = function (rootpath, confpath) {
  try {
    mkdirp.sync(path.join(rootpath, 'var', 'log'));
    mkdirp.sync(path.join(rootpath, 'var', 'run'));
    mkdirp.sync(path.join(confpath));
  } catch(e) {
    console.error(e);
  }
};

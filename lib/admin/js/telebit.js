;(function (exports) {
'use strict';

var common = exports.TELEBIT = {};

/* global Promise */
var PromiseA;
if ('undefined' !== typeof Promise) {
  PromiseA = Promise;
} else {
  throw new Error("no Promise implementation defined");
}

if ('undefined' !== typeof fetch) {
  common.requestAsync = function (opts) {
    /*
    if (opts.json && true !== opts.json) {
      opts.body = opts.json;
    }
    if (opts.json) {
      if (!opts.headers) { opts.headers = {}; }
      if (opts.body) {
        opts.headers['Content-Type'] = 'application/json';
      } else {
        opts.headers.Accepts = 'application/json';
      }
    }
    */
    // funnel requests through the local server
    // (avoid CORS, for now)
    var relayOpts = {
      url: '/api/relay'
    , method: 'POST'
    , headers: {
        'Content-Type': 'application/json'
      , 'Accepts': 'application/json'
      }
    , body: JSON.stringify(opts)
    };
    return window.fetch(relayOpts.url, relayOpts).then(function (resp) {
      return resp.json().then(function (json) {
        /*
        var headers = {};
        resp.headers.forEach(function (k, v) {
          headers[k] = v;
        });
        return { statusCode: resp.status, headers: headers, body: json };
        */
        if (json.error) {
          return PromiseA.reject(new Error(json.error && json.error.message || JSON.stringify(json.error)));
        }
        return json;
      });
    });
  };
} else {
  common.requestAsync = require('util').promisify(require('@coolaj86/urequest'));
}

common.parseUrl = function (hostname) {
  // add scheme, if missing
  if (!/:\/\//.test(hostname)) {
    hostname = 'https://' + hostname;
  }
  var location = new URL(hostname);
  hostname = location.hostname + (location.port ? ':' + location.port : '');
  hostname = location.protocol.replace(/https?/, 'https') + '//' + hostname + location.pathname;
  return hostname;
};
common.parseHostname = function (hostname) {
  var location = new URL(hostname);
  if (!location.protocol || /\./.test(location.protocol)) {
    hostname = 'https://' + hostname;
    location = new URL(hostname);
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
  console.log('state:');
  console.log(state);
  state._relayUrl = common.parseUrl(state.relay);
  common.requestAsync({ url: state._relayUrl + common.apiDirectory, json: true }).then(function (resp) {
    var dir = resp.body;
    if (!dir) { dir = { api_host: ':hostname', tunnel: { method: "wss", pathname: "" } }; }
    state._apiDirectory = dir;
    next(null, dir);
  }).catch(function (err) {
    next(err);
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
        // TODO make call to daemon for this info beforehand
        /*
        , hostname: os.hostname()
          // Used for User-Agent
        , os_type: os.type()
        , os_platform: os.platform()
        , os_release: os.release()
        , os_arch: os.arch()
        */
        };
        var pairRequestUrl = new URL(dir.pair_request.pathname, 'https://' + dir.api_host.replace(/:hostname/g, state._relayHostname));
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
          common.requestAsync(req).then(function (resp) {
            var body = resp.body;

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
                    err._resp = resp.toJSON && resp.toJSON();
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
          }).catch(function (err) {
            if (common.debug) { console.log('[debug] gotoNext error'); }
            err._request = req;
            err._hint = '[telebitd.js] pair request';
            handlers.error(err, function () {});
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
}('undefined' !== typeof module ? module.exports : window));

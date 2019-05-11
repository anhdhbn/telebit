;(function (exports) {
'use strict';

var common = exports.TELEBIT = {};
common.debug = true;

/* global Promise */
var PromiseA;
if ('undefined' !== typeof Promise) {
  PromiseA = Promise;
} else {
  throw new Error("no Promise implementation defined");
}

/*globals AbortController*/
if ('undefined' !== typeof fetch) {
  common.requestAsync = function (opts) {
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
    var controller = new AbortController();
    var tok = setTimeout(function () {
      controller.abort();
    }, 4000);
    if (!relayOpts) {
      relayOpts = {};
    }
    relayOpts.signal = controller.signal;
    return window.fetch(relayOpts.url, relayOpts).then(function (resp) {
      clearTimeout(tok);
      return resp.json().then(function (json) {
        if (json.error) {
          return PromiseA.reject(new Error(json.error && json.error.message || JSON.stringify(json.error)));
        }
        return json;
      });
    });
  };
  common.reqLocalAsync = function (opts) {
    if (!opts) { opts = {}; }
    if (opts.json && true !== opts.json) {
      opts.body = opts.json;
      opts.json = true;
    }
    if (opts.json) {
      if (!opts.headers) { opts.headers = {}; }
      if (opts.body) {
        opts.headers['Content-Type'] = 'application/json';
        if ('string' !== typeof opts.body) {
          opts.body = JSON.stringify(opts.body);
        }
      } else {
        opts.headers.Accepts = 'application/json';
      }
    }
    var controller = new AbortController();
    var tok = setTimeout(function () {
      controller.abort();
    }, 4000);
    opts.signal = controller.signal;
    return window.fetch(opts.url, opts).then(function (resp) {
      clearTimeout(tok);
      return resp.json().then(function (json) {
        var headers = {};
        resp.headers.forEach(function (k, v) {
          headers[k] = v;
        });
        return { statusCode: resp.status, headers: headers, body: json };
      });
    });
  };
} else {
  common.requestAsync = require('util').promisify(require('@root/request'));
  common.reqLocalAsync = require('util').promisify(require('@root/request'));
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
  var location = {};
  try {
    location = new URL(hostname);
  } catch(e) {
    // ignore
  }
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
  var JWT = require('./jwt.js');
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

  return JWT.sign(tokenData, state.config.secret);
};
common.promiseTimeout = function (ms) {
  var tok;
  var p = new PromiseA(function (resolve) {
    tok = setTimeout(function () {
      resolve();
    }, ms);
  });
  p.cancel = function () {
    clearTimeout(tok);
  };
  return p;
};
common.api = {};
common.api.directory = function (state) {
  console.log('[DEBUG] state:');
  console.log(state);
  state._relayUrl = common.parseUrl(state.relay);
  if (!state._relays) { state._relays = {}; }
  if (state._relays[state._relayUrl]) {
    return PromiseA.resolve(state._relays[state._relayUrl]);
  }
  return common.requestAsync({ url: state._relayUrl + common.apiDirectory, json: true }).then(function (resp) {
    var dir = resp.body;
    state._relays[state._relayUrl] = dir;
    return dir;
  });
};
common.api._parseWss = function (state, dir) {
  if (!dir || !dir.api_host) {
    dir = { api_host: ':hostname', tunnel: { method: "wss", pathname: "" } };
  }
  state._relayHostname = common.parseHostname(state.relay);
  return dir.tunnel.method + '://' + dir.api_host.replace(/:hostname/g, state._relayHostname) + dir.tunnel.pathname;
};
common.api.wss = function (state) {
  return common.api.directory(state).then(function (dir) {
    return common.api._parseWss(state, dir);
  });
};
common.api.token = function (state, handlers) {

  var firstReady = true;
  function pollStatus(req) {
    if (common.debug) { console.log('[debug] pollStatus called'); }
    if (common.debug) { console.log(req); }
    return common.requestAsync(req).then(function checkLocation(resp) {
      var body = resp.body;
      if (common.debug) { console.log('[debug] checkLocation'); }
      if (common.debug) { console.log(body); }
      // pending, try again
      if ('pending' === body.status && resp.headers.location) {
        if (common.debug) { console.log('[debug] pending'); }
        return common.promiseTimeout(2 * 1000).then(function () {
          return pollStatus({ url: resp.headers.location, json: true });
        });
      } else if ('ready' === body.status) {
        if (common.debug) { console.log('[debug] ready'); }
        if (firstReady) {
          if (common.debug) { console.log('[debug] first ready'); }
          firstReady = false;
          // falls through on purpose
          PromiseA.resolve(handlers.offer(body.access_token)).then(function () {
            /*ignore*/
          });
        }
        return common.promiseTimeout(2 * 1000).then(function () {
          return pollStatus(req);
        });
      } else if ('complete' === body.status) {
        if (common.debug) { console.log('[debug] complete'); }
        return PromiseA.resolve(handlers.granted(null)).then(function () {
          return PromiseA.resolve(handlers.end(null)).then(function () {});
        });
      } else {
        if (common.debug) { console.log('[debug] bad status'); }
        var err = new Error("Bad State:" + body.status);
        err._request = req;
        return PromiseA.reject(err);
      }
    }).catch(function (err) {
      if (common.debug) { console.log('[debug] pollStatus error'); }
      err._request = req;
      err._hint = '[telebitd.js] pair request';
      return PromiseA.resolve(handlers.error(err)).then(function () {});
    });
  }

  // directory, requested, connect, tunnelUrl, offer, granted, end
  function requestAuth(dir) {
    if (common.debug) { console.log('[debug] after dir'); }
    state.wss = common.api._parseWss(state, dir);

    return PromiseA.resolve(handlers.tunnelUrl(state.wss)).then(function () {
      if (common.debug) { console.log('[debug] after tunnelUrl'); }
      if (state.config.secret /* && !state.config.token */) {
        // TODO make token here in the browser
        //state.config._token = common.signToken(state);
      }
      state.token = state.token || state.config.token || state.config._token;
      if (state.token) {
        if (common.debug) { console.log('[debug] token via token or secret'); }
        // { token, pretoken }
        return PromiseA.resolve(handlers.connect(state.token)).then(function () {
          return PromiseA.resolve(handlers.end(null));
        });
      }

      if (!dir.pair_request) {
        if (common.debug) { console.log('[debug] no dir, connect'); }
        return PromiseA.resolve(handlers.error(new Error("No token found or generated, and no pair_request api found.")));
      }

      // TODO sign token with own private key, including public key and thumbprint
      //      (much like ACME JOSE account)
      // TODO handle agree
      var otp = state._otp; // common.otp();
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
      console.log('pairRequestUrl:', pairRequestUrl);
      //console.log('pairRequestUrl:', JSON.stringify(pairRequestUrl.toJSON()));
      var req = {
        // WHATWG URL defines .toJSON() but, of course, it's not implemented
        // because... why would we implement JavaScript objects in the DOM
        // when we can have perfectly incompatible non-JS objects?
        url: {
          host: pairRequestUrl.host
        , hostname: pairRequestUrl.hostname
        , href: pairRequestUrl.href
        , pathname: pairRequestUrl.pathname
          // because why wouldn't node require 'path' on a json object and accept 'pathname' on a URL object...
          // https://twitter.com/coolaj86/status/1053947919890403328
        , path: pairRequestUrl.pathname
        , port: pairRequestUrl.port || null
        , protocol: pairRequestUrl.protocol
        , search: pairRequestUrl.search || null
        }
      , method: dir.pair_request.method
      , json: authReq
      };

      return common.requestAsync(req).then(function doFirst(resp) {
        var body = resp.body;
        if (common.debug) { console.log('[debug] first req'); }
        if (!body.access_token && !body.jwt) {
          return PromiseA.reject(new Error("something wrong with pre-authorization request"));
        }
        return PromiseA.resolve(handlers.requested(authReq, resp.headers.location)).then(function () {
          return PromiseA.resolve(handlers.connect(body.access_token || body.jwt)).then(function () {
            var err;
            if (!resp.headers.location) {
              err = new Error("bad authentication request response");
              err._resp = resp.toJSON && resp.toJSON();
              return PromiseA.resolve(handlers.error(err)).then(function () {});
            }
            return common.promiseTimeout(2 * 1000).then(function () {
              return pollStatus({ url: resp.headers.location, json: true });
            });
          });
        });
      }).catch(function (err) {
        if (common.debug) { console.log('[debug] gotoFirst error'); }
        err._request = req;
        err._hint = '[telebitd.js] pair request';
        return PromiseA.resolve(handlers.error(err)).then(function () {});
      });
    });
  }

  if (state.pollUrl) {
    return pollStatus({ url: state.pollUrl, json: true });
  }

  // backwards compat (TODO verify we can remove this)
  var failoverDir = '{ "api_host": ":hostname", "tunnel": { "method": "wss", "pathname": "" } }';
  return common.api.directory(state).then(function (dir) {
    console.log('[debug] [directory]', dir);
    if (!dir.api_host) { dir = JSON.parse(failoverDir); }
    return dir;
  }).catch(function (err) {
    console.warn('[warn] [directory] fetch fail, using failover');
    console.warn(err);
    return JSON.parse(failoverDir);
  }).then(function (dir) {
    return PromiseA.resolve(handlers.directory(dir)).then(function () {
      console.log('[debug] [directory]', dir);
      return requestAuth(dir);
    });
  });
};

}('undefined' !== typeof module ? module.exports : window));

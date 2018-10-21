;(function (exports) {
'use strict';

/* global Promise */
var PromiseA;
if ('undefined' !== typeof Promise) {
  PromiseA = Promise;
} else {
  throw new Error("no Promise implementation defined");
}

var common = exports.TELEBIT || require('./lib/common.js');

common.authorize = common.getToken = function getToken(state) {
  state.relay = state.config.relay;

  // { _otp, config: {} }
  return common.api.token(state, {
    error: function (err) {
      console.error("[Error] common.api.token handlers.error:");
      console.error(err);
      return PromiseA.reject(err);
    }
  , directory: function (dir) {
      //console.log('[directory] Telebit Relay Discovered:');
      //console.log(dir);
      state._apiDirectory = dir;
      return PromiseA.resolve();
    }
  , tunnelUrl: function (tunnelUrl) {
      //console.log('[tunnelUrl] Telebit Relay Tunnel Socket:', tunnelUrl);
      state.wss = tunnelUrl;
      return PromiseA.resolve();
    }
  , requested: function (authReq) {
      console.log("[requested] Pairing Requested");
      state.config._otp = state.config._otp = authReq.otp;

      if (!state.config.token && state._can_pair) {
        console.info("0000".replace(/0000/g, state.config._otp));
      }

      return PromiseA.resolve();
    }
  , connect: function (pretoken) {
      console.log("[connect] Enabling Pairing Locally...");
      state.config.pretoken = pretoken;
      state._connecting = true;

      return common.reqLocalAsync({ url: '/api/config', method: 'POST', body: state.config }).then(function () {
        console.info("waiting...");
        return PromiseA.resolve();
      }).catch(function (err) {
        state._error = err;
        console.error("Error while initializing config [connect]:");
        console.error(err);
        return PromiseA.reject(err);
      });
    }
  , offer: function (token) {
      //console.log("[offer] Pairing Enabled by Relay");
      state.config.token = token;
      if (state._error) {
        return;
      }
      state._connecting = true;
      try {
        //require('jsonwebtoken').decode(token);
        token = token.split('.');
        token[0] = token[0].replace(/_/g, '/').replace(/-/g, '+');
        while (token[0].length % 4) { token[0] += '='; }
        btoa(token[0]);
        token[1] = token[1].replace(/_/g, '/').replace(/-/g, '+');
        while (token[1].length % 4) { token[1] += '='; }
        btoa(token[1]);
        //console.log(require('jsonwebtoken').decode(token));
      } catch(e) {
        console.warn("[warning] could not decode token");
      }
      return common.reqLocalAsync({ url: '/api/config', method: 'POST', body: state.config }).then(function () {
        //console.log("Pairing Enabled Locally");
        return PromiseA.resolve();
      }).catch(function (err) {
        state._error = err;
        console.error("Error while initializing config [offer]:");
        console.error(err);
        return PromiseA.reject(err);
      });
    }
  , granted: function (/*_*/) {
      //console.log("[grant] Pairing complete!");
      return PromiseA.resolve();
    }
  , end: function () {
      return common.reqLocalAsync({ url: '/api/enable', method: 'POST', body: [] }).then(function () {
        console.info("Success");

        // workaround for https://github.com/nodejs/node/issues/21319
        if (state._useTty) {
          setTimeout(function () {
            console.info("Some fun things to try first:\n");
            console.info("    ~/telebit http ~/public");
            console.info("    ~/telebit tcp 5050");
            console.info("    ~/telebit ssh auto");
            console.info();
            console.info("Press any key to continue...");
            console.info();
            process.exit(0);
          }, 0.5 * 1000);
          return;
        }
        // end workaround

        //parseCli(state);
      }).catch(function (err) {
        console.error('[end] [error]', err);
        return PromiseA.reject(err);
      });
    }
  });
};

}('undefined' === typeof module ? window : module.exports));

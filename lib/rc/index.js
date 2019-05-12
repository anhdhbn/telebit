'use strict';

var os = require('os');
var path = require('path');
var http = require('http');
var keypairs = require('keypairs');

var common = require('../cli-common.js');

/*
function packConfig(config) {
  return Object.keys(config).map(function (key) {
    var val = config[key];
    if ('undefined' === val) {
      throw new Error("'undefined' used as a string value");
    }
    if ('undefined' === typeof val) {
      //console.warn('[DEBUG]', key, 'is present but undefined');
      return;
    }
    if (val && 'object' === typeof val && !Array.isArray(val)) {
      val = JSON.stringify(val);
    }
    return key + ':' + val; // converts arrays to strings with ,
  });
}
*/

module.exports.create = function (state) {
  common._init(
    // make a default working dir and log dir
    state._clientConfig.root || path.join(os.homedir(), '.local/share/telebit')
  , (state._clientConfig.root && path.join(state._clientConfig.root, 'etc'))
      || path.resolve(common.DEFAULT_CONFIG_PATH, '..')
  );
  state._ipc = common.pipename(state._clientConfig, true);

  function makeResponder(service, resp, fn) {
    var body = '';

    function finish() {
      var err;

      if (200 !== resp.statusCode) {
        err = new Error(body || ('get ' + service + ' failed'));
        err.statusCode = resp.statusCode;
        err.code = "E_REQUEST";
      }

      if (body) {
        try {
          body = JSON.parse(body);
        } catch(e) {
          console.error('Error:', err);
          // ignore
        }
      }

      fn(err, body);
    }

    if (!resp.headers['content-length'] && !resp.headers['content-type']) {
      finish();
      return;
    }

    // TODO use readable
    resp.on('data', function (chunk) {
      body += chunk.toString();
    });
    resp.on('end', finish);
  }

  var RC = {};
  RC.resolve = function (pathstr) {
    // TODO use real hostname and return reqOpts rather than string?
    return 'http://localhost:' + (RC.port({}).port||'1').toString() + '/' + pathstr.replace(/^\//, '');
  };
  RC.port = function (reqOpts) {
    var fs = require('fs');
    var portFile = path.join(path.dirname(state._ipc.path), 'telebit.port');
    if (fs.existsSync(portFile)) {
      reqOpts.host = 'localhost';
      reqOpts.port = parseInt(fs.readFileSync(portFile, 'utf8').trim(), 10);
      if (!state.ipc) {
        state.ipc = {};
      }
      state.ipc.type = 'port';
      state.ipc.path = path.dirname(state._ipc.path);
      state.ipc.port = reqOpts.port;
    } else {
      reqOpts.socketPath = state._ipc.path;
    }
    return reqOpts;
  };
  RC.createErrorHandler = function (replay, opts, cb) {
    return function (err) {
      // ENOENT - never started, cleanly exited last start, or creating socket at a different path
      // ECONNREFUSED - leftover socket just needs to be restarted
      if ('ENOENT' === err.code || 'ECONNREFUSED' === err.code) {
        if (opts._taketwo) {
          cb(err);
          return;
        }
        require('../../usr/share/install-launcher.js').install({ env: process.env }, function (err) {
          if (err) { cb(err); return; }
          opts._taketwo = true;
          setTimeout(function () {
            replay(opts, cb);
          }, 2500);
        });
        return;
      }

      cb(err);
    };
  };
  RC.request = function request(opts, fn) {
    if (!opts) { opts = {}; }
    var service = opts.service || 'config';
    /*
    var args = opts.data;
    if (args && 'control' === service) {
      args = packConfig(args);
    }
    var json = JSON.stringify(opts.data);
    */
    var url = '/rpc/' + service;
    /*
    if (json) {
      url += ('?_body=' + encodeURIComponent(json));
    }
    */
    var method = opts.method || (opts.data && 'POST') || 'GET';
    var reqOpts = {
      method: method
    , path: url
    };
    reqOpts = RC.port(reqOpts);
    var req = http.request(reqOpts, function (resp) {
      makeResponder(service, resp, fn);
    });

    req.on('error', RC.createErrorHandler(RC.request, opts, fn));

    // Simple GET
    if ('POST' !== method || !opts.data) {
      return keypairs.signJwt({
        jwk: state.key
      , claims: { iss: false, exp: Math.round(Date.now()/1000) + (15 * 60) }
      //TODO , exp: '15m'
      }).then(function (jwt) {
        req.setHeader("Authorization", 'Bearer ' + jwt);
        req.end();
      });
    }

    return keypairs.signJws({
      jwk: state.key
    , protected: {
        // alg will be filled out automatically
        jwk: state.pub
      , kid: false
      , nonce: require('crypto').randomBytes(16).toString('hex') // TODO get from server
        // TODO make localhost exceptional
      , url: RC.resolve(reqOpts.path)
      }
    , payload: JSON.stringify(opts.data)
    }).then(function (jws) {
      req.setHeader("Content-Type", 'application/jose+json');
      req.write(JSON.stringify(jws));
      req.end();
    });
  };
  return RC;
};

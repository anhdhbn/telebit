'use strict';

var os = require('os');
var path = require('path');
var http = require('http');

var common = require('../cli-common.js');

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
  RC.request = function request(opts, fn) {
    if (!opts) { opts = {}; }
    var service = opts.service || 'config';
    var args = opts.data;
    if (args && 'control' === service) {
      args = packConfig(args);
    }
    var json = JSON.stringify(args);
    var url = '/rpc/' + service;
    if (json) {
      url += ('?_body=' + encodeURIComponent(json));
    }
    var method = opts.method || (args && 'POST') || 'GET';
    var reqOpts = {
      method: method
    , path: url
    };
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
    var req = http.request(reqOpts, function (resp) {
      makeResponder(service, resp, fn);
    });

    req.on('error', function (err) {
      // ENOENT - never started, cleanly exited last start, or creating socket at a different path
      // ECONNREFUSED - leftover socket just needs to be restarted
      if ('ENOENT' === err.code || 'ECONNREFUSED' === err.code) {
        if (opts._taketwo) {
          fn(err);
          return;
        }
        require('../../usr/share/install-launcher.js').install({ env: process.env }, function (err) {
          if (err) { fn(err); return; }
          opts._taketwo = true;
          setTimeout(function () {
            RC.request(opts, fn);
          }, 2500);
        });
        return;
      }

      fn(err);
    });
    if ('POST' === method && opts.data) {
      req.setHeader("content-type", 'application/json');
      req.write(json || opts.data);
    }
    req.end();
  };
  return RC;
};

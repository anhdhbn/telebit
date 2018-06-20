'use strict';

var common = module.exports;

var path = require('path');
var mkdirp = require('mkdirp');
var os = require('os');
var homedir = os.homedir();

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
  var url = require('url');
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
  var url = require('url');
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

function leftpad(i, n, c) {
  while (i.toString().length < (n || 4)) {
    i = (c || '0') + i;
  }
  return i;
}
common.otp = function getOtp() {
  return leftpad(Math.round(Math.random() * 9999), 4, '0');
};

common.urequest = function (opts, cb) {
  var https = require('https');
  // request.js behavior:
  // encoding: null + json ? unknown
  // json => attempt to parse, fail silently
  // encoding => buffer.toString(encoding)
  // null === encoding => Buffer.concat(buffers)
  https.get(opts.url, function (resp) {
    var encoding = opts.encoding;
    if (null === encoding) {
      resp._body = [];
    } else {
      resp.body = '';
    }
    if (!resp.headers['content-length'] || 0 === parseInt(resp.headers['content-length'], 10)) {
      cb(resp);
    }
    resp._bodyLength = 0;
    resp.on('data', function (chunk) {
      if ('string' === typeof resp.body) {
        resp.body += chunk.toString(encoding);
      } else {
        resp._body.push(chunk);
        resp._bodyLength += chunk.length;
      }
    });
    resp.on('end', function () {
      if ('string' !== typeof resp.body) {
        if (1 === resp._body.length) {
          resp.body = resp._body[0];
        } else {
          resp.body = Buffer.concat(resp._body, resp._bodyLength);
        }
        resp._body = null;
      }
      if (opts.json && 'string' === typeof resp.body) {
        // TODO I would parse based on Content-Type
        // but request.js doesn't do that.
        try {
          resp.body = JSON.parse(resp.body);
        } catch(e) {
          // ignore
        }
      }
      cb(null, resp, resp.body);
    });
  }).on('error', function (e) {
    cb(e);
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

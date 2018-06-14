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
    _ipc.path = '\\\\?\\pipe' + pipename.replace(/\//, '\\');
  }
  if (newApi) {
    return _ipc;
  }
  return _ipc.path;
};
common.DEFAULT_SOCK_NAME = path.join(homedir, localshare, 'var', 'run', 'telebit.sock');

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

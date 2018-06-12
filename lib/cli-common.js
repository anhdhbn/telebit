'use strict';

var common = module.exports;

var path = require('path');
var mkdirp = require('mkdirp');
var os = require('os');
var homedir = os.homedir();

var localshare = '.local/share/telebit';
var localconf = '.config/telebit';

common.pipename = function (config) {
  var pipename = (config.sock || common.DEFAULT_SOCK_NAME);
  if (/^win/i.test(os.platform())) {
    pipename = '\\\\?\\pipe' + pipename.replace(/\//, '\\');
  }
  return pipename;
};
common.DEFAULT_SOCK_NAME = path.join(homedir, localshare, 'var', 'telebit.sock');

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

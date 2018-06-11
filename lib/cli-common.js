'use strict';

var common = module.exports;

var path = require('path');
var mkdirp = require('mkdirp');
var os = require('os');
var homedir = os.homedir();

var localshare = '.local/share/telebit/var';
var localconf = '.config/telebit';

common.pipename = function (config) {
  var pipename = (config.sock || common.DEFAULT_SOCK_NAME);
  if (/^win/i.test(os.platform())) {
    pipename = '\\\\?\\pipe' + pipename.replace(/\//, '\\');
  }
  return pipename;
};
common.DEFAULT_SOCK_NAME = path.join(homedir, localshare, 'telebit.sock');

try {
  mkdirp.sync(path.join(homedir, localshare));
  mkdirp.sync(path.join(homedir, localconf));
} catch(e) {
  console.error(e);
}

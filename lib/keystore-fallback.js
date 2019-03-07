'use strict';

var fs = require('fs').promises;
var path = require('path');

module.exports.create = function (opts) {
  return {
    getPassword: function (service, name) {
      var f = path.join(opts.configDir, name + '.key');
      return fs.readFile(f, 'utf8').catch(function (err) {
        if ('ENOEXIST' === err.code) {
          return;
        }
      });
    }
  , setPassword: function (service, name, key) {
      var f = path.join(opts.configDir, name + '.key');
      return fs.writeFile(f, key, 'utf8');
    }
  , deletePassword: function (service, name) {
      var f = path.join(opts.configDir, name + '.key');
      return fs.unlink(f);
    }
  , insecure: true
  };
};

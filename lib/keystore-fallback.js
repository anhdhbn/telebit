'use strict';
/*global Promise*/

var fs = require('fs').promises;
var path = require('path');

module.exports.create = function (opts) {
  var keyext = '.key';
  return {
    getPassword: function (service, name) {
      var f = path.join(opts.configDir, name + keyext);
      return fs.readFile(f, 'utf8').catch(function (err) {
        if ('ENOEXIST' === err.code) {
          return;
        }
      });
    }
  , setPassword: function (service, name, key) {
      var f = path.join(opts.configDir, name + keyext);
    console.log('[DEBUG] set', f);
      return fs.writeFile(f, key, 'utf8');
    }
  , deletePassword: function (service, name) {
      var f = path.join(opts.configDir, name + keyext);
      return fs.unlink(f);
    }
  , findCredentials: function (/*service*/) {
      return fs.readdir(opts.configDir).then(function (nodes) {
        return Promise.all(nodes.filter(function (node) {
          return keyext === node.slice(-4);
        }).map(function (node) {
          return fs.readFile(path.join(opts.configDir, node), 'utf8').then(function (data) {
            return { password: data };
          });
        }));
      });
    }
  , insecure: true
  };
};

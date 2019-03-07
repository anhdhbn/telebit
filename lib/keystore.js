'use strict';

module.exports.create = function (opts) {
  var service = "Telebit";
  var keytar;
  try {
    keytar = require('keytar');
  } catch(e) {
    console.warn("Could not load native key management. Keys will be stored in plain text.");
    keytar = require('./keystore-fallback.js').create(opts);
    keytar.insecure = true;
  }

  return {
    get: function (name) {
      return keytar.getPassword(service, name).then(maybeParse);
    }
  , set: function (name, value) {
      return keytar.setPassword(service, name, maybeStringify(value));
    }
  , delete: function (name) {
      return keytar.deletePassword(service, name);
    }
  , insecure: keytar.insecure
  };
};

function maybeParse(str) {
  if (str && '{' === str[0]) {
    return JSON.parse(str);
  }
  return str;
}

function maybeStringify(obj) {
  if ('string' !== typeof obj && 'object' === typeof obj) {
    return JSON.stringify(obj);
  }
  return obj;
}

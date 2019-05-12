(function () {
'use strict';

var keystore = require('./keystore.js').create({
  configDir: require('path').join(require('os').homedir(), '.config/telebit/')
, fallback: true
});

var name = "testy-mctestface-1";
return keystore.get(name).then(function (jwk) {
  console.log("get1", typeof jwk, jwk);
  if (!jwk || !jwk.kty) {
    return require('keypairs').generate().then(function (jwk) {
      var json = JSON.stringify(jwk.private);
      return keystore.set(name, json).then(function () {
        return keystore.all().then(function (vals) {
          console.log("All", vals);
          return keystore.get(name).then(function (val2) {
            console.log("get2", val2);
          });
        });
      }).catch(function (err) {
        console.log('badness', err);
      });
    });
  }
  return jwk;
});
}());

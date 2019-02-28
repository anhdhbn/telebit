'use strict';

var crypto = require('crypto');
var JWT = module.exports;

JWT.decode = function (jwt) {
  var parts;

  try {
    parts = jwt.split('.');
    return {
      header: JSON.parse(Buffer.from(parts[0], 'base64'))
    , payload: JSON.parse(Buffer.from(parts[1], 'base64'))
    , signature: parts[2] //Buffer.from(parts[2], 'base64')
    };
  } catch(e) {
    throw new Error("JWT Parse Error: could not split, base64 decode, and JSON.parse token " + jwt);
  }
};

JWT.verify = function (jwt) {
  var decoded = JWT.decode(jwt);
  throw new Error("not implemented yet");
};

function base64ToUrlSafe(str) {
  return str
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
  ;
}

JWT.sign = function (claims, key) {
  if (!claims.iat && false !== claims.iat) {
    claims.iat = Math.round(Date.now()/1000);
  }
  var thumb = base64ToUrlSafe(crypto.createHash('sha256').update(key).digest('base64'));
  var protect = base64ToUrlSafe(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: thumb })).toString('base64'));
  var payload = base64ToUrlSafe(Buffer.from(JSON.stringify(claims)).toString('base64'));
  var signature = base64ToUrlSafe(crypto.createHmac('sha256', key).update(protect + '.' + payload).digest('base64'));
  return protect + '.' + payload + '.' + signature;
};

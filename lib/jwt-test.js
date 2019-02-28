'use strict';

var crypto = require('crypto');
var FAT = require('jsonwebtoken');
var JWT = require('./jwt.js');

var key = "justanothersecretsecret";
var keyid = crypto.createHash('sha256').update(key).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

var tok1 = FAT.sign({ foo: "hello" }, key, { keyid: keyid });
var tok2 = JWT.sign({ foo: "hello" }, key);

if (tok1 !== tok2) {
  console.error(JWT.decode(tok1));
  console.error(JWT.decode(tok2));
  throw new Error("our jwt doesn't match auth0/jsonwebtoken");
}

console.info('Pass');

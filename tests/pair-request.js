'use strict';

var email = 'jon@example.com';
var pin = Math.round(Math.random() * 999999).toString().padStart(6, '0'); // '321654'

console.log('Pair Code:', pin);

var urequest = require('@root/request');
var req =  {
  url: 'https://api.telebit.ppl.family/api/telebit.cloud/pair_request'
, method: 'POST'
, headers: { 'cOntEnt-tYpE': 'application/json;charset=utf-8' }
, json: {
    subject: email
  , subject_scheme: 'mailto'
  , scope: ''
  , otp: pin
  , hostname: "User's Macbook Pro"
  , os_type: 'Linux'
  , os_platform: 'linux'
  , os_release: '4.4.0-116-generic'
  , os_arch: 'x64'
  }
};
urequest(req, function (err, resp, body) {
  if (err) {
    console.error(err);
    return;
  }
  console.log('Location:', resp.headers.location);
  console.log('Body:');
  console.log(body);
  /*
  { jwt: '...'
  }
   */
});

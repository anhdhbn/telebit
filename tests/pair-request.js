'use strict';

var email = 'jon@example.com';

var urequest = require('@coolaj86/urequest');
var req =  {
  url: 'https://api.telebit.ppl.family/api/telebit.cloud/pair_request'
, method: 'POST'
, headers: { 'cOntEnt-tYpE': 'application/json;charset=utf-8' }
, json: {
	  subject: email
	, subject_scheme: 'mailto'
	, scope: ''
	, otp: '321654'
	, hostname: "Jon's Macbook Pro"
	, os_type: 'Linux'
	, os_platform: 'linux'
  , os_release: '4.4.0-116-generic'
	,	os_arch: 'x64'
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
});

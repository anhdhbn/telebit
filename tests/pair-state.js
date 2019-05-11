'use strict';

var stateUrl = 'https://api.telebit.ppl.family/api/telebit.cloud/pair_state/bca27428719e9c67805359f1';

var urequest = require('@root/request');
var req =  {
  url: stateUrl
, method: 'GET'
, json: true
};
urequest(req, function (err, resp, body) {
  if (err) {
    console.error(err);
    return;
  }
  console.log('Done:');
  console.log(body);
  /*
   body.status = 'ready' | 'pending' | 'complete' | 'invalid'
   body.access_token // only in 'ready' state
   */
});

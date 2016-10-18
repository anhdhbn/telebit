'use strict';

var request = require('request');

function run(copts) {
  var tunnelUrl = 'https://tunnel.daplie.com/?access_token=' + copts.token;
  request.get(tunnelUrl, { rejectUnauthorized: false }, function (err, resp) {
    console.log('resp.body');
    console.log(resp.body);
  });
}

module.exports.connect = run;

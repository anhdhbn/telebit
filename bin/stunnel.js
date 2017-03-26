#!/usr/bin/env node
(function () {
'use strict';

var pkg = require('../package.json');

var program = require('commander');
var url = require('url');
var stunnel = require('../wsclient.js');

function collectProxies(val, memo) {
  var vals = val.split(/,/g);

  function parseProxy(location) {
    // http:john.example.com:3000
    // http://john.example.com:3000
    var parts = location.split(':');
    var dual = false;
    if (/\./.test(parts[0])) {
      //dual = true;
      parts[2] = parts[1];
      parts[1] = parts[0];
      parts[0] = 'https';
      dual = true;
    }
    parts[0] = parts[0].toLowerCase();
    parts[1] = parts[1].toLowerCase().replace(/(\/\/)?/, '') || '*';
    parts[2] = parseInt(parts[2], 10) || 0;
    if (!parts[2]) {
      // TODO grab OS list of standard ports?
      if ('http' === parts[0]) {
        parts[2] = 80;
      }
      else if ('https' === parts[0]) {
        parts[2] = 443;
      }
      else {
        throw new Error("port must be specified - ex: tls:*:1337");
      }
    }

    memo.push({
      protocol: parts[0]
    , hostname: parts[1]
    , port: parts[2]
    });

    if (dual) {
      memo.push({
        protocol: 'http'
      , hostname: parts[1]
      , port: parts[2]
      });
    }
  }

  vals.map(function (val) {
    return parseProxy(val);
  });

  return memo;
}

program
  .version(pkg.version)
  //.command('jsurl <url>')
  .arguments('<url>')
  .action(function (url) {
    program.url = url;
  })
  .option('-k --insecure', 'Allow TLS connections to stunneld without valid certs (rejectUnauthorized: false)')
  .option('--locals <LINE>', 'comma separated list of <proto>:<//><servername>:<port> to which matching incoming http and https should forward (reverse proxy). Ex: https://john.example.com,tls:*:1337', collectProxies, [ ]) // --reverse-proxies
  .option('--stunneld <URL>', 'the domain (or ip address) at which you are running stunneld.js (the proxy)') // --proxy
  .option('--secret <STRING>', 'the same secret used by stunneld (used for JWT authentication)')
  .option('--token <STRING>', 'a pre-generated token for use with stunneld (instead of generating one with --secret)')
  .option('--agree-tos', 'agree to the Daplie Terms of Service (requires user validation)')
  .option('--email <EMAIL>', 'email address (or cloud address) for user validation')
  .option('--oauth3-url <URL>', 'Cloud Authentication to use (default: https://oauth3.org)')
  .parse(process.argv)
  ;

function connectTunnel() {
  program.net = {
    createConnection: function (info, cb) {
      // data is the hello packet / first chunk
      // info = { data, servername, port, host, remoteFamily, remoteAddress, remotePort }
      var net = require('net');
      // socket = { write, push, end, events: [ 'readable', 'data', 'error', 'end' ] };
      var socket = net.createConnection({ port: info.port, host: info.host }, cb);
      return socket;
    }
  };

  program.locals.forEach(function (proxy) {
    console.log('[local proxy]', proxy.protocol + '://' + proxy.hostname + ':' + proxy.port);
  });

  stunnel.connect(program);
}

function rawTunnel() {
  program.stunneld = program.stunneld || 'wss://tunnel.daplie.com';

  if (!(program.secret || program.token)) {
    console.error("You must use --secret or --token with --stunneld");
    process.exit(1);
    return;
  }

  var jwt = require('jsonwebtoken');
  var tokenData = {
    domains: null
  };
  var location = url.parse(program.stunneld);

  if (!location.protocol || /\./.test(location.protocol)) {
    program.stunneld = 'wss://' + program.stunneld;
    location = url.parse(program.stunneld);
  }
  program.stunneld = location.protocol + '//' + location.hostname + (location.port ? ':' + location.port : '');

  tokenData.domains = Object.keys(domainsMap);

  program.token = program.token || jwt.sign(tokenData, program.secret);

  connectTunnel();
}

function daplieTunnel() {
  //var OAUTH3 = require('oauth3.js');
  var Oauth3Cli = require('oauth3.js/bin/oauth3.js');
  require('oauth3.js/oauth3.tunnel.js');
  return Oauth3Cli.login({
    email: program.email
  , providerUri: program.oauth3Url
  }).then(function (oauth3) {
    return oauth3.api('tunnel.token', { data: { device: 'test.local', domains: [] } }).then(function (results) {
      console.log('tunnel.token results');
      console.log(results);
    });
  });
}

var domainsMap = {};
program.locals.forEach(function (proxy) {
  domainsMap[proxy.hostname] = true;
});

if (!(program.secret || program.token) && !program.stunneld) {
  daplieTunnel();
}
else {
  rawTunnel();
}

}());

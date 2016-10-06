#!/usr/bin/env node
(function () {
'use strict';

var pkg = require('../package.json');

var program = require('commander');
var url = require('url');
var stunnel = require('../wsclient.js');

function collectProxies(val, memo) {
  var vals = val.split(/,/g);
  vals.map(function (location) {
    // http:john.example.com:3000
    // http://john.example.com:3000
    var parts = location.split(':');
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

    return {
      protocol: parts[0]
    , hostname: parts[1]
    , port: parts[2]
    };
  }).forEach(function (val) {
    memo.push(val);
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
  .parse(process.argv)
  ;

program.stunneld = program.stunneld || 'wss://pokemap.hellabit.com:3000';

var jwt = require('jsonwebtoken');
var domainsMap = {};
var tokenData = {
  name: null
, domains: null
};
var location = url.parse(program.stunneld);

if (!location.protocol || /\./.test(location.protocol)) {
  program.stunneld = 'wss://' + program.stunneld;
  location = url.parse(program.stunneld);
}
program.stunneld = location.protocol + '//' + location.hostname + (location.port ? ':' + location.port : '');

program.locals.forEach(function (proxy) {
  domainsMap[proxy.hostname] = true;
});
tokenData.domains = Object.keys(domainsMap);
tokenData.name = tokenData.domains[0];

program.services = {};
program.locals.forEach(function (proxy) {
  //program.services = { 'ssh': 22, 'http': 80, 'https': 443 };
  program.services[proxy.protocol] = proxy.port;
});
program.token = program.token || jwt.sign(tokenData, program.secret || 'shhhhh');

program.net = {
  createConnection: function (info, cb) {
    /*
    var Dup = {
      write: function (chunk, encoding, cb) {
        //console.log('_write', chunk.byteLength);
        this.__my_socket.write(chunk, encoding);
        cb();
      }
    , read: function (size) {
        //console.log('_read');
        var x = this.__my_socket.read(size);
        if (x) {
          console.log('_read', size);
          this.push(x);
        }
      }
    };
    var myDuplex = new (require('streams').Duplex);
    myDuplex._write = Dup.write;
    myDuplex._read = Dup.read;
    myDuplex.remoteFamily = socket.remoteFamily;
    myDuplex.remoteAddress = socket.remoteAddress;
    myDuplex.remotePort = socket.remotePort;
    myDuplex.localFamily = socket.localFamily;
    myDuplex.localAddress = socket.localAddress;
    myDuplex.localPort = socket.localPort;
    httpsServer.emit('connection', myDuplex);
    */

    // data is the hello packet / first chunk
    // info = { data, servername, port, host, remoteAddress: { family, address, port } }
    var net = require('net');
    // socket = { write, push, end, events: [ 'readable', 'data', 'error', 'end' ] };
    var socket = net.createConnection({ port: info.port, host: info.host }, cb);
    return socket;
  }
};
stunnel.connect(program);

}());

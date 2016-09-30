(function () {
'use strict';

var pkg = require('../package.json');

var program = require('commander');
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
  }).forEach(memo.push);

  return memo;
}

program
  .version(pkg.version)
  //.command('jsurl <url>')
  .arguments('<url>')
  .action(function (url) {
    program.url = url;
  })
  .option('-k --insecure', 'Allow TLS connections to stunneld without valid certs (H)')
  .option('--locals <LINE>', 'comma separated list of <proto>:<//><servername>:<port> to which matching incoming http and https should forward (reverse proxy). Ex: https://john.example.com,tls:*:1337', collectProxies, [ ]) // --reverse-proxies
  .option('--stunneld <URL>', 'the domain (or ip address) at which you are running stunneld.js (the proxy)') // --proxy
  .option('--secret', 'the same secret used by stunneld (used for JWT authentication)')
  .option('--token', 'a pre-generated token for use with stunneld (instead of generating one with --secret)')
  .parse(process.argv)
  ;

// Assumption: will not get next tcp packet unless previous packet succeeded
var hostname = 'aj.daplie.me'; // 'pokemap.hellabit.com'
var jwt = require('jsonwebtoken');

program.services = {};
program.locals.forEach(function (proxy) {
  //program.services = { 'ssh': 22, 'http': 80, 'https': 443 };
  program.services[proxy.protocol] = proxy.port;
});
program.token = program.token || jwt.sign({ name: hostname }, program.secret || 'shhhhh');
program.stunneld = program.stunneld || 'wss://pokemap.hellabit.com:3000';

stunnel.connect(program);

}());

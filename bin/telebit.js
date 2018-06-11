#!/usr/bin/env node
(function () {
'use strict';

var pkg = require('../package.json');

//var url = require('url');
var path = require('path');
var http = require('http');
var YAML = require('js-yaml');
var recase = require('recase').create({});
var camelCopy = recase.camelCopy.bind(recase);
//var snakeCopy = recase.snakeCopy.bind(recase);

var common = require('../lib/cli-common.js');

var argv = process.argv.slice(2);

var confIndex = argv.indexOf('--config');
var confpath;
var confargs;
if (-1 === confIndex) {
  confIndex = argv.indexOf('-c');
}
if (-1 !== confIndex) {
  confargs = argv.splice(confIndex, 2);
  confpath = confargs[1];
}

function help() {
  console.info('');
  console.info('Telebit Remote v' + pkg.version);
  console.info('');
  console.info('Usage:');
  console.info('');
  console.info('\ttelebit [--config <path>] <module> <module-option>');
  console.info('');
  console.info('Examples:');
  console.info('');
  console.info('\ttelebit status                          # whether enabled or disabled');
  console.info('\ttelebit enable                          # disallow incoming connections');
  console.info('\ttelebit disable                         # allow incoming connections');
  console.info('');
  console.info('\ttelebit list                            # list rules for servernames and ports');
  console.info('');
  console.info('\ttelebit http none                       # remove all https handlers');
  console.info('\ttelebit http 3000                       # forward all https traffic to port 3000');
  console.info('\ttelebit http /module/path               # load a node module to handle all https traffic');
  console.info('');
  console.info('\ttelebit http none example.com           # remove https handler from example.com');
  console.info('\ttelebit http 3001 example.com           # forward https traffic for example.com to port 3001');
  console.info('\ttelebit http /module/path example.com   # forward https traffic for example.com to port 3001');
  console.info('');
  console.info('\ttelebit tcp none                        # remove all tcp handlers');
  console.info('\ttelebit tcp 5050                        # forward all tcp to port 5050');
  console.info('\ttelebit tcp /module/path                # handle all tcp with a node module');
  console.info('');
  console.info('\ttelebit tcp none 6565                   # remove tcp handler from external port 6565');
  console.info('\ttelebit tcp 5050 6565                   # forward external port 6565 to local 5050');
  console.info('\ttelebit tcp /module/path 6565           # handle external port 6565 with a node module');
  console.info('');
  console.info('Config:');
  console.info('');
  console.info('\tSee https://git.coolaj86.com/coolaj86/telebit.js');
  console.info('');
  console.info('');
}

var verstr = '' + pkg.name + ' v' + pkg.version;
if (-1 === confIndex) {
  confpath = path.join(require('os').homedir(), '.config/telebit/telebit.yml');
  verstr += ' (--config "' + confpath + '")';
}
console.info(verstr + '\n');

if (-1 !== argv.indexOf('-h') || -1 !== argv.indexOf('--help')) {
  help();
  process.exit(0);
}
if (!confpath || /^--/.test(confpath)) {
  help();
  process.exit(1);
}

function askForConfig() {
  console.log("Please create a config file at '" + confpath + "' or specify --config /path/to/config");
}

function parseConfig(err, text) {
  var config;

  if (err) {
    console.error("\nCouldn't load config:\n\n\t" + err.message + "\n");
    if ('ENOENT' === err.code) {
      text = 'relay: \'\'';
    }
    askForConfig();
  }

  try {
    config = JSON.parse(text);
  } catch(e1) {
    try {
      config = YAML.safeLoad(text);
    } catch(e2) {
      console.error(e1.message);
      console.error(e2.message);
      process.exit(1);
      return;
    }
  }

  config = camelCopy(config);

  function putConfig(service, args) {
    // console.log('got it', service, args);
    var req = http.get({
      socketPath: common.pipename(config)
    , method: 'POST'
    , path: '/rpc/' + service + '?_body=' + JSON.stringify(args)
    }, function (resp) {

      function finish() {
        if (200 !== resp.statusCode) {
          console.warn("'" + service + "' may have failed."
           + " Consider peaking at the logs either with 'journalctl -xeu telebit' or /opt/telebit/var/log/error.log");
          console.warn(resp.statusCode, body);
        } else {
          if (body) {
            console.info('Response');
            console.info(body);
          } else {
            console.info("👌");
          }
        }
      }

      var body = '';
      if (resp.headers['content-length']) {
        resp.on('data', function (chunk) {
          body += chunk.toString();
        });
        resp.on('end', function () {
          finish();
        });
      } else {
        finish();
      }
    });
    req.on('error', function (err) {
      console.error('Error');
      console.error(err);
      return;
    });
  }

  // Two styles:
  //     http 3000
  //     http modulename
  function makeRpc(key) {
    if (key !== argv[0]) {
      return false;
    }
    putConfig(argv[0], argv.slice(1));
    return true;
  }

  if ([ 'ssh', 'http', 'tcp' ].some(function (key) {
    if (key !== argv[0]) {
      return false;
    }
    if (argv[1]) {
      putConfig(argv[0], argv.slice(1));
      return true;
    }
    help();
    return true;
  })) {
    return true;
  }

  if ([ 'status', 'enable', 'disable', 'restart', 'list', 'save' ].some(makeRpc)) {
    return;
  }

  help();
}

require('fs').readFile(confpath, 'utf8', parseConfig);

}());

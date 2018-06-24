#!/usr/bin/env node
(function () {
'use strict';

var pkg = require('../package.json');
var os = require('os');

//var url = require('url');
var path = require('path');
var http = require('http');
var https = require('https');
var YAML = require('js-yaml');
var recase = require('recase').create({});
var camelCopy = recase.camelCopy.bind(recase);
//var snakeCopy = recase.snakeCopy.bind(recase);

var urequest = require('@coolaj86/urequest');
var common = require('../lib/cli-common.js');

var argv = process.argv.slice(2);

var argIndex = argv.indexOf('--config');
var confpath;
var useTty;
var state = {};
if (-1 === argIndex) {
  argIndex = argv.indexOf('-c');
}
if (-1 !== argIndex) {
  confpath = argv.splice(argIndex, 2)[1];
}
argIndex = argv.indexOf('--tty');
if (-1 !== argIndex) {
  useTty = argv.splice(argIndex, 1);
}

function help() {
  console.info('');
  console.info('Telebit Remote v' + pkg.version);
  console.info('');
  console.info('Usage:');
  console.info('');
  console.info('\ttelebit [--config <path>] <module> <module-options>');
  console.info('');
  console.info('Examples:');
  console.info('');
  //console.info('\ttelebit init                            # bootstrap the config files');
  //console.info('');
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

var verstr = [ pkg.name + ' remote v' + pkg.version ];
if (!confpath) {
  confpath = path.join(os.homedir(), '.config/telebit/telebit.yml');
  verstr.push('(--config "' + confpath + '")');
}

if (-1 !== argv.indexOf('-h') || -1 !== argv.indexOf('--help')) {
  help();
  process.exit(0);
}
if (!confpath || /^--/.test(confpath)) {
  help();
  process.exit(1);
}

function askForConfig(answers, mainCb) {
  answers = answers || {};
  //console.log("Please create a config file at '" + confpath + "' or specify --config /path/to/config");
  var fs = require('fs');
  var stdin = useTty ? fs.createReadStream('/dev/tty') : process.stdin;
  var readline = require('readline');
  var rl = readline.createInterface({
    input: stdin
  , output: process.stdout
    // https://github.com/nodejs/node/issues/21319
  , terminal: !useTty
  });
  answers._useTty = useTty;

  // NOTE: Use of setTimeout
  // We're using setTimeout just to make the user experience a little
  // nicer, as if we're doing something inbetween steps, so that it
  // is a smooth rather than jerky experience.
  // >= 300ms is long enough to become distracted and change focus (a full blink, time for an idea to form as a thought)
  // <= 100ms is shorter than normal human reaction time (ability to place events chronologically, which happened first)
  // ~ 150-250ms is the sweet spot for most humans (long enough to notice change and not be jarred, but stay on task)
  var firstSet = [
    function askEmail(cb) {
      if (answers.email) { cb(); return; }
      console.info("");
      console.info("");
      console.info("Telebit uses Greenlock for free automated ssl through Let's Encrypt.");
      console.info("");
      console.info("To accept the Terms of Service for Telebit, Greenlock and Let's Encrypt,");
      console.info("please enter your email.");
      console.info("");
      // TODO attempt to read email from npmrc or the like?
      rl.question('email: ', function (email) {
        email = /@/.test(email) && email.trim();
        if (!email) { askEmail(cb); return; }
        answers.email = email.trim();
        answers.agree_tos = true;
        console.info("");
        setTimeout(cb, 250);
      });
    }
  , function askRelay(cb) {
      function checkRelay(relay) {
        // TODO parse and check https://{{relay}}/.well-known/telebit.cloud/directives.json
        if (!relay) { relay = 'telebit.cloud'; }
        relay = relay.trim();
        var urlstr = common.parseUrl(relay) + common.apiDirectory;
        urequest({ url: urlstr, json: true }, function (err, resp, body) {
          if (err) {
            console.error("[Network Error] Failed to retrieve '" + urlstr + "'");
            console.error(err);
            askRelay(cb);
            return;
          }
          if (200 !== resp.statusCode || (Buffer.isBuffer(body) || 'object' !== typeof body) || !body.api_host) {
            console.warn("===================");
            console.warn("      WARNING      ");
            console.warn("===================");
            console.warn("");
            console.warn("[" + resp.statusCode + "] '" + urlstr + "'");
            console.warn("This server does not describe a current telebit version (but it may still work).");
            console.warn("");
            console.warn(body);
          } else if (body && body.pair_request) {
            answers._can_pair = true;
          }
          answers.relay = relay;
          cb();
        });
      }

      if (answers.relay) { checkRelay(); return; }
      console.info("");
      console.info("");
      console.info("What relay will you be using? (press enter for default)");
      console.info("");
      rl.question('relay [default: telebit.cloud]: ', checkRelay);
    }
  , function checkRelay(cb) {
      nextSet = [];
      if ('telebit.cloud' !== answers.relay) {
        nextSet = nextSet.concat(standardSet);
      }
      if (!answers._can_pair) {
        nextSet = nextSet.concat(fossSet);
      }
      cb();
    }
  ];
  var standardSet = [
    // There are questions that we need to aks in the CLI
    // if we can't guarantee that they are being asked in the web interface
    function askAgree(cb) {
      if (answers.agree_tos) { cb(); return; }
      console.info("");
      console.info("");
      console.info("Do you accept the terms of service for each and all of the following?");
      console.info("");
      console.info("\tTelebit - End-to-End Encrypted Relay");
      console.info("\tGreenlock - Automated HTTPS");
      console.info("\tLet's Encrypt - TLS Certificates");
      console.info("");
      console.info("Type 'y' or 'yes' to accept these Terms of Service.");
      console.info("");
      rl.question('agree to all? [y/N]: ', function (resp) {
        resp = resp.trim();
        if (!/^y(es)?$/i.test(resp) && 'true' !== resp) {
          throw new Error("You didn't accept the Terms of Service... not sure what to do...");
        }
        answers.agree_tos = true;
        console.info("");
        setTimeout(cb, 250);
      });
    }
  , function askUpdates(cb) {
      // required means transactional, security alerts, mandatory updates
      var options = [ 'newsletter', 'important', 'required' ];
      if (-1 !== options.indexOf(answers.updates)) { cb(); return; }
      console.info("");
      console.info("");
      console.info("What updates would you like to receive? (" + options.join(',') + ")");
      console.info("");
      rl.question('messages (default: important): ', function (updates) {
        updates = (updates || '').trim().toLowerCase();
        if (!updates) { updates = 'important'; }
        if (-1 === options.indexOf(updates)) { askUpdates(cb); return; }

        if ('newsletter' === updates) {
          answers.newsletter = true;
          answers.communityMember = true;
        } else if ('important' === updates) {
          answers.communityMember = true;
        }

        setTimeout(cb, 250);
      });
    }
  , function askTelemetry(cb) {
      if (answers.telemetry) { cb(); return; }
      console.info("");
      console.info("");
      console.info("Contribute project telemetry data? (press enter for default [yes])");
      console.info("");
      rl.question('telemetry [Y/n]: ', function (telemetry) {
        if (!telemetry || /^y(es)?$/i.test(telemetry)) {
          answers.telemetry = true;
        }
        setTimeout(cb, 250);
      });
    }
  ];
  var fossSet = [
    function askTokenOrSecret(cb) {
      if (answers._can_pair || answers.token || answers.secret) { cb(); return; }
      console.info("");
      console.info("");
      console.info("What's your authorization for '" + answers.relay + "'?");
      console.info("");
      // TODO check .well-known to learn supported token types
      console.info("Currently supported:");
      console.info("");
      console.info("\tToken (JWT format)");
      console.info("\tShared Secret (HMAC hex)");
      //console.info("\tPrivate key (hex)");
      console.info("");
      rl.question('auth: ', function (resp) {
        var jwt = require('jsonwebtoken');
        resp = (resp || '').trim();
        try {
          answers.token = jwt.decode(resp);
        } catch(e) {
          // is not jwt
          try {
            if (JSON.parse(resp).subject) {
              answers.token = resp;
            }
          } catch(e) {
            // is not authRequest either
          }
        }
        if (!answers.token) {
          resp = resp.toLowerCase();
          if (resp === Buffer.from(resp, 'hex').toString('hex')) {
            answers.secret = resp;
          }
        }
        if (!answers.token && !answers.secret) {
          askTokenOrSecret(cb);
          return;
        }
        setTimeout(cb, 250);
      });
    }
  , function askServernames(cb) {
      if (!answers.secret || answers.servernames) { cb(); return; }
      console.info("");
      console.info("");
      console.info("What servername(s) will you be relaying here?");
      console.info("(use a comma-separated list such as example.com,example.net)");
      console.info("");
      rl.question('domain(s): ', function (resp) {
        resp = (resp || '').trim().split(/,/g);
        if (!resp.length) { askServernames(); return; }
        // TODO validate the domains
        answers.servernames = resp;
        setTimeout(cb, 250);
      });
    }
  , function askPorts(cb) {
      if (!answers.secret || answers.ports) { cb(); return; }
      console.info("");
      console.info("");
      console.info("What tcp port(s) will you be relaying here?");
      console.info("(use a comma-separated list such as 2222,5050)");
      console.info("");
      rl.question('port(s) [default:none]: ', function (resp) {
        resp = (resp || '').trim().split(/,/g);
        if (!resp.length) { askPorts(); return; }
        // TODO validate the domains
        answers.ports = resp;
        setTimeout(cb, 250);
      });
    }
  ];
  var nextSet = firstSet;

  function next() {
    var q = nextSet.shift();
    if (!q) {
      // https://github.com/nodejs/node/issues/21319
      if (useTty) { stdin.push(null); }
      rl.close();
      if (useTty) { try { stdin.close(); } catch(e) { /*ignore*/ } }
      mainCb(null, answers);
      return;
    }
    q(next);
  }

  next();
}

var utils = {
  putConfig: function putConfig(service, args, fn) {
    // console.log('got it', service, args);
    var req = http.get({
      socketPath: state._ipc.path
    , method: 'POST'
    , path: '/rpc/' + service + '?_body=' + JSON.stringify(args)
    }, function (resp) {

      function finish() {
        if ('function' === typeof fn) {
          fn(null, resp);
          return;
        }

        console.info("");
        if (200 !== resp.statusCode) {
          console.warn("'" + service + "' may have failed."
           + " Consider peaking at the logs either with 'journalctl -xeu telebit' or /opt/telebit/var/log/error.log");
          console.warn(resp.statusCode, body);
          //cb(new Error("not okay"), body);
          return;
        }

        if (!body) {
          console.info("👌");
          return;
        }

        try {
          body = JSON.parse(body);
        } catch(e) {
          // ignore
        }

        if ("AWAIT_AUTH" === body.code) {
          console.info(body.message);
        } else if ("CONFIG" === body.code) {
          delete body.code;
          console.info(YAML.safeDump(body));
        } else {
          console.info(JSON.stringify(body, null, 2));
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
      console.error('Put Config Error:');
      console.error(err);
      return;
    });
  }
};

function parseConfig(err, text) {

  console.info("");
  console.info(verstr.join(' '));

  try {
    state.config = JSON.parse(text || '{}');
  } catch(e1) {
    try {
      state.config = YAML.safeLoad(text || '{}');
    } catch(e2) {
      console.error(e1.message);
      console.error(e2.message);
      process.exit(1);
      return;
    }
  }

  state.config = camelCopy(state.config || {}) || {};
  state._ipc = common.pipename(state.config, true);

  if (!Object.keys(state.config).length) {
    console.info('(' + state._ipc.comment + ": " + state._ipc.path + ')');
  }
  console.info("");

  if ((err && 'ENOENT' === err.code) || !Object.keys(state.config).length) {
    if (!err || 'ENOENT' === err.code) {
      //console.warn("Empty config file. Run 'telebit init' to configure.\n");
    } else {
      console.warn("Couldn't load config:\n\n\t" + err.message + "\n");
    }
  }

  // Two styles:
  //     http 3000
  //     http modulename
  function makeRpc(key) {
    if (key !== argv[0]) {
      return false;
    }
    utils.putConfig(argv[0], argv.slice(1));
    return true;
  }

  if ([ 'ssh', 'http', 'tcp' ].some(function (key) {
    if (key !== argv[0]) {
      return false;
    }
    if (argv[1]) {
      utils.putConfig(argv[0], argv.slice(1));
      return true;
    }
    help();
    return true;
  })) {
    return true;
  }

  if (-1 !== argv.indexOf('init')) {
    parsers.init(argv, function (err, answers) {
      if (err) {
        console.error("Error while initializing config:");
        throw err;
      }

      // TODO use php-style object querification
      utils.putConfig('config', Object.keys(answers).map(function (key) {
        return key + ':' + answers[key];
      }), function (err/*, body*/) {
        if (err) {
          console.error("Error while initializing config:");
          throw err;
        }

        // need just a little time to let the grants occur
        setTimeout(function () {
          utils.putConfig('list', []);

          // workaround for https://github.com/nodejs/node/issues/21319
          if (answers._useTty) {
            setTimeout(function () {
              process.exit(0);
            }, 2 * 1000);
          }
          // end workaround

        }, 1 * 1000);
      });
    });
    return;
  }

  if ([ 'status', 'enable', 'disable', 'restart', 'list', 'save' ].some(makeRpc)) {
    return;
  }

  help();
}

var parsers = {
  init: function (argv, cb) {
    var answers = {};
    var bool = [
      '--advanced'
    ];
    if ('init' !== argv[0]) {
      throw new Error("init must be the first argument");
    }
    argv.shift();
    // init --foo bar
    argv.forEach(function (arg, i) {
      if (!/^--/.test(arg)) { return; }
      if (-1 !== bool.indexOf(arg)) {
        answers['_' + arg.replace(/^--/, '')] = true;
      }
      if (/^-/.test(argv[i + 1])) {
        throw new Error(argv[i + 1] + ' requires an argument');
      }
      answers[arg] = argv[i + 1];
    });
    // init foo:bar
    argv.forEach(function (arg) {
      if (/^--/.test(arg)) { return; }
      var parts = arg.split(/:/g);
      if (2 !== parts.length) {
        throw new Error("bad option to init: '" + arg + "'");
      }
      if (answers[parts[0]]) {
        throw new Error("duplicate key to init '" + parts[0] + "'");
      }
      answers[parts[0]] = parts[1];
    });

    if (!answers._advanced && !answers.relay) {
      answers.relay = 'telebit.cloud';
    }

    askForConfig(answers, function (err, answers) {
      if (err) { cb(err); return; }

      if (!answers.token && answers._can_pair) {
        answers._otp = common.otp();
        console.log("");
        console.log("==============================================");
        console.log("                 Hey, Listen!                 ");
        console.log("==============================================");
        console.log("                                              ");
        console.log("  GO CHECK YOUR EMAIL!                        ");
        console.log("                                              ");
        console.log("  DEVICE PAIR CODE:     0000                  ".replace(/0000/g, answers._otp));
        console.log("                                              ");
        console.log("==============================================");
        console.log("");
      }

      cb(null, answers);
    });
  }
};

require('fs').readFile(confpath, 'utf8', parseConfig);

}());

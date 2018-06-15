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
      if (answers.relay) { cb(); return; }
      console.info("");
      console.info("");
      console.info("What relay will you be using? (press enter for default)");
      console.info("");
      function parseUrl(hostname) {
        var url = require('url');
        var location = url.parse(hostname);
        if (!location.protocol || /\./.test(location.protocol)) {
          hostname = 'https://' + hostname;
          location = url.parse(hostname);
        }
        hostname = location.hostname + (location.port ? ':' + location.port : '');
        hostname = location.protocol.replace(/https?/, 'https') + '//' + hostname + location.pathname;
        return hostname;
      }
      rl.question('relay [default: telebit.cloud]: ', function (relay) {
        // TODO parse and check https://{{relay}}/.well-known/telebit.cloud/directives.json
        if (!relay) { relay = 'telebit.cloud'; }
        answers.relay = relay.trim();
        var urlstr = parseUrl(answers.relay) + '_apis/telebit.cloud/index.json';
        https.get(urlstr, function (resp) {
          var body = '';
          if (200 !== resp.statusCode) {
            console.error("[" + resp.statusCode + " Error] Failed to retrieve '" + urlstr + "'");
            askRelay(cb);
            return;
          }
          resp.on('data', function (chunk) {
            body += chunk.toString('utf8');
          });
          resp.on('end', function () {
            try {
              body = JSON.parse(body);
            } catch(e) {
              console.error("[Parse Error] Failed to retrieve '" + urlstr + "'");
              console.error(e);
              askRelay(cb);
              return;
            }
            if (!(body.api_host)) {
              console.error("[API Error] API Index '" + urlstr + "' does not describe a known version of telebit.cloud");
              console.error(e);
              askRelay(cb);
              return;
            }
            if (body.pair_request) {
              answers._can_pair = true;
            }
            cb();
          });
        }).on('error', function (e) {
          console.error("[Network Error] Failed to retrieve '" + urlstr + "'");
          console.error(e);
          askRelay(cb);
        });
      });
    }
  , function askAgree(cb) {
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
  , function checkRelay(cb) {
      if (!/\btelebit\.cloud\b/i.test(answers.relay)) {
        standardSet = standardSet.concat(advancedSet);
      }
      nextSet = standardSet;
      cb();
    }
  ];
  var standardSet = [
    function askUpdates(cb) {
      var options = [ 'newsletter', 'important', 'required' ];
      if (-1 !== options.indexOf(answers.updates)) { cb(); return; }
      console.info("");
      console.info("");
      console.info("What updates would you like to receive? (" + options.join(',') + ")");
      console.info("");
      rl.question('email preference (default: important): ', function (updates) {
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
    /*
  , function askNewsletter(cb) {
      if (answers.newsletter) { cb(); return; }
      console.info("");
      console.info("");
      console.info("Would you like to subscribe to our newsletter? (press enter for default [no])");
      console.info("");
      rl.question('newsletter [y/N] (default: no): ', function (newsletter) {
        if (/^y(es)?$/.test(newsletter)) {
          answers.newsletter = true;
        }
        setTimeout(cb, 250);
      });
    }
  , function askCommunity(cb) {
      if (answers.community_member) { cb(); return; }
      console.info("");
      console.info("");
      console.info("Receive important and relevant updates? (press enter for default [yes])");
      console.info("");
      rl.question('community_member [Y/n]: ', function (community) {
        if (!community || /^y(es)?$/i.test(community)) {
          answers.community_member = true;
        }
        setTimeout(cb, 250);
      });
    }
    */
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
  var advancedSet = [
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
          // delete answers.token;
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
      rl.close();
      if (useTty) { stdin.close(); }
      mainCb(null, answers);
      return;
    }
    q(next);
  }

  next();
}

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

  function putConfig(service, args) {
    // console.log('got it', service, args);
    var req = http.get({
      socketPath: state._ipc.path
    , method: 'POST'
    , path: '/rpc/' + service + '?_body=' + JSON.stringify(args)
    }, function (resp) {

      function finish() {
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

  if (-1 !== argv.indexOf('init')) {
    var answers = {};
    if ('init' !== argv[0]) {
      throw new Error("init must be the first argument");
    }
    argv.shift();
    argv.forEach(function (arg) {
      var parts = arg.split(/:/g);
      if (2 !== parts.length) {
        throw new Error("bad option to init: '" + arg + "'");
      }
      if (answers[parts[0]]) {
        throw new Error("duplicate key to init '" + parts[0] + "'");
      }
      answers[parts[0]] = parts[1];
    });
    askForConfig(answers, function (err, answers) {
      // TODO use php-style object querification
      putConfig('config', Object.keys(answers).map(function (key) {
        return key + ':' + answers[key];
      }));
      /* TODO
      if [ "telebit.cloud" == $my_relay ]; then
        echo ""
        echo ""
        echo "=============================================="
        echo "                 Hey, Listen!                 "
        echo "=============================================="
        echo ""
        echo "GO CHECK YOUR EMAIL"
        echo ""
        echo "You MUST verify your email address to activate this device."
        echo "(if the activation link expires, just run 'telebit restart' and check your email again)"
        echo ""
        $read_cmd -p "hit [enter] once you've clicked the verification" my_ignore
      fi
      */
    });
    return;
  }

  if ([ 'status', 'enable', 'disable', 'restart', 'list', 'save' ].some(makeRpc)) {
    return;
  }

  help();
}

require('fs').readFile(confpath, 'utf8', parseConfig);

}());

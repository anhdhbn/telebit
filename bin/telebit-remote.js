#!/usr/bin/env node
(function () {
'use strict';

var pkg = require('../package.json');
var os = require('os');

//var url = require('url');
var fs = require('fs');
var path = require('path');
//var https = require('https');
var YAML = require('js-yaml');
var TOML = require('toml');
var TPLS = TOML.parse(fs.readFileSync(path.join(__dirname, "../lib/en-us.toml"), 'utf8'));

/*
if ('function' !== typeof TOML.stringify) {
  TOML.stringify = require('json2toml');
}
*/
var recase = require('recase').create({});
var camelCopy = recase.camelCopy.bind(recase);
//var snakeCopy = recase.snakeCopy.bind(recase);

var urequest = require('@coolaj86/urequest');
var common = require('../lib/cli-common.js');

var argv = process.argv.slice(2);

var argIndex = argv.indexOf('--config');
if (-1 === argIndex) {
  argIndex = argv.indexOf('-c');
}
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
  var keys = Object.keys(TPLS.help).filter(function (key) {
    return 'remote' !== key;
  });
  var key = keys.filter(function (key) {
    return -1 !== process.argv.indexOf(key);
  })[0] || 'remote';
  console.info(TPLS.help[key].replace(/{version}/g, pkg.version));
}

var verstr = [ pkg.name + ' remote v' + pkg.version ];
if (!confpath) {
  confpath = path.join(os.homedir(), '.config/telebit/telebit.yml');
  verstr.push('(--config \'' + confpath.replace(new RegExp('^' + os.homedir()), '~') + '\')');
}

if ([ '-h', '--help', 'help' ].some(function (arg) {
  return -1 !== argv.indexOf(arg);
})) {
  help();
  process.exit(0);
}
if (!confpath || /^--/.test(confpath)) {
  help();
  process.exit(1);
}

function askForConfig(state, mainCb) {
  var fs = require('fs');
  var ttyname = '/dev/tty';
  var stdin = useTty ? fs.createReadStream(ttyname, {
    fd: fs.openSync(ttyname, fs.constants.O_RDONLY | fs.constants.O_NOCTTY)
  }) : process.stdin;
  var readline = require('readline');
  var rl = readline.createInterface({
    input: stdin
  , output: process.stdout
    // https://github.com/nodejs/node/issues/21771
    // https://github.com/nodejs/node/issues/21319
  , terminal: !/^win/i.test(os.platform()) && !useTty
  });
  state._useTty = useTty;

  // NOTE: Use of setTimeout
  // We're using setTimeout just to make the user experience a little
  // nicer, as if we're doing something inbetween steps, so that it
  // is a smooth rather than jerky experience.
  // >= 300ms is long enough to become distracted and change focus (a full blink, time for an idea to form as a thought)
  // <= 100ms is shorter than normal human reaction time (ability to place events chronologically, which happened first)
  // ~ 150-250ms is the sweet spot for most humans (long enough to notice change and not be jarred, but stay on task)
  var firstSet = [
    function askEmail(cb) {
      if (state.config.email) { cb(); return; }
      //console.info("");
      console.info("Welcome!");
      console.info("");
      console.info("By using Telebit you agree to:");
      console.info("");
      console.info("    [x] Accept the Telebit™ terms of service");
      console.info("    [x] Accept the Let's Encrypt™ terms of service");
      console.info("");
      console.info("Enter your email to agree and login/create your account:");
      console.info("");
      // TODO attempt to read email from npmrc or the like?
      rl.question('email: ', function (email) {
        email = /@/.test(email) && email.trim();
        if (!email) { askEmail(cb); return; }
        state.config.email = email.trim();
        state.config.agreeTos = true;
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
            state._can_pair = true;
          }
          state.config.relay = relay;
          cb();
        });
      }

      if (state.config.relay) { checkRelay(state.config.relay); return; }
      console.info("");
      console.info("");
      console.info("What relay will you be using? (press enter for default)");
      console.info("");
      rl.question('relay [default: telebit.cloud]: ', checkRelay);
    }
  , function checkRelay(cb) {
      nextSet = [];
      if ('telebit.cloud' !== state.config.relay) {
        nextSet = nextSet.concat(standardSet);
      }
      if (!state._can_pair) {
        nextSet = nextSet.concat(fossSet);
      }
      cb();
    }
  ];
  var standardSet = [
    // There are questions that we need to aks in the CLI
    // if we can't guarantee that they are being asked in the web interface
    function askAgree(cb) {
      if (state.config.agreeTos) { cb(); return; }
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
        state.config.agreeTos = true;
        console.info("");
        setTimeout(cb, 250);
      });
    }
  , function askUpdates(cb) {
      // required means transactional, security alerts, mandatory updates
      var options = [ 'newsletter', 'important', 'required' ];
      if (-1 !== options.indexOf(state._updates)) { cb(); return; }
      console.info("");
      console.info("");
      console.info("What updates would you like to receive? (" + options.join(',') + ")");
      console.info("");
      rl.question('messages (default: important): ', function (updates) {
        state._updates = (updates || '').trim().toLowerCase();
        if (!state._updates) { state._updates = 'important'; }
        if (-1 === options.indexOf(state._updates)) { askUpdates(cb); return; }

        if ('newsletter' === state._updates) {
          state.config.newsletter = true;
          state.config.communityMember = true;
        } else if ('important' === state._updates) {
          state.config.communityMember = true;
        }

        setTimeout(cb, 250);
      });
    }
  , function askTelemetry(cb) {
      if (state.config.telemetry) { cb(); return; }
      console.info("");
      console.info("");
      console.info("Contribute project telemetry data? (press enter for default [yes])");
      console.info("");
      rl.question('telemetry [Y/n]: ', function (telemetry) {
        if (!telemetry || /^y(es)?$/i.test(telemetry)) {
          state.config.telemetry = true;
        }
        setTimeout(cb, 250);
      });
    }
  ];
  var fossSet = [
    function askTokenOrSecret(cb) {
      if (state._can_pair || state.token || state.config.token
        || state.secret || state.config.secret) { cb(); return; }
      console.info("");
      console.info("");
      console.info("What's your authorization for '" + state.config.relay + "'?");
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
          jwt.decode(resp);
          state.config.token = resp;
        } catch(e) {
          // is not jwt
        }
        if (!state.config.token) {
          resp = resp.toLowerCase();
          if (resp === Buffer.from(resp, 'hex').toString('hex')) {
            state.config.secret = resp;
          }
        }
        if (!state.config.token && !state.config.secret) {
          askTokenOrSecret(cb);
          return;
        }
        setTimeout(cb, 250);
      });
    }
  , function askServernames(cb) {
      if (!state.config.secret || state.config._servernames) { cb(); return; }
      console.info("");
      console.info("");
      console.info("What servername(s) will you be relaying here?");
      console.info("(use a comma-separated list such as example.com,example.net)");
      console.info("");
      rl.question('domain(s): ', function (resp) {
        resp = (resp || '').trim().split(/,/g);
        if (!resp.length) { askServernames(); return; }
        // TODO validate the domains
        state.config._servernames = resp;
        setTimeout(cb, 250);
      });
    }
  , function askPorts(cb) {
      if (!state.config.secret || state.config._ports) { cb(); return; }
      console.info("");
      console.info("");
      console.info("What tcp port(s) will you be relaying here?");
      console.info("(use a comma-separated list such as 2222,5050)");
      console.info("");
      rl.question('port(s) [default:none]: ', function (resp) {
        resp = (resp || '').trim().split(/,/g);
        if (!resp.length) { askPorts(); return; }
        // TODO validate the domains
        state.config._ports = resp;
        setTimeout(cb, 250);
      });
    }
  ];
  var nextSet = firstSet;

  function next() {
    var q = nextSet.shift();
    if (!q) {
      // https://github.com/nodejs/node/issues/21319
      if (useTty) { try { stdin.push(null); } catch(e) { /*ignore*/ } }
      rl.close();
      if (useTty) { try { stdin.close(); } catch(e) { /*ignore*/ } }
      mainCb(null, state);
      return;
    }
    q(next);
  }

  next();
}

var RC;

function parseConfig(err, text) {
  function handleConfig(err, config) {
    //console.log('CONFIG');
    //console.log(config);
    state.config = config;
    var verstrd = [ pkg.name + ' daemon v' + state.config.version ];
    if (state.config.version && state.config.version !== pkg.version) {
      console.info(verstr.join(' '), verstrd.join(' '));
    } else {
      console.info(verstr.join(' '));
    }

    if (err) {
      if ('ENOENT' === err.code || 'ECONNREFUSED' === err.code) {
        console.error("Either the telebit service was not already (and could not be started) or its socket could not be written to.");
        console.error(err);
      } else if ('ENOTSOCK' === err.code) {
        console.error(err);
        return;
      } else {
        console.error(err);
      }
      process.exit(101);
      return;
    }

    //
    // check for init first, before anything else
    // because it has arguments that may help in
    // the next steps
    //
    if (-1 !== argv.indexOf('init')) {
      parsers.init(argv, function (err) {
        if (err) {
          console.error("Error while initializing config [init]:");
          throw err;
        }
        getToken(function (err) {
          if (err) {
            console.error("Error while getting token [init]:");
            throw err;
          }
          parseCli(state);
        });
      });
      return;
    }

    if (!state.config.relay || !state.config.token) {
      if (!state.config.relay) {
        state.config.relay = 'telebit.cloud';
      }

      //console.log("question the user?", Date.now());
      askForConfig(state, function (err, state) {
        // no errors actually get passed, so this is just future-proofing
        if (err) { throw err; }

        if (!state.config.token && state._can_pair) {
          state.config._otp = common.otp();
        }

        //console.log("done questioning:", Date.now());
        if (!state.token && !state.config.token) {
          if (err) {
            console.error("Error while initializing config [init]:");
            throw err;
          }
          getToken(function (err) {
            if (err) {
              console.error("Error while getting token [init]:");
              throw err;
            }
            parseCli(state);
          });
        } else {
          parseCli(state);
        }
      });
      return;
    }

    //console.log("no questioning:");
    parseCli(state);
  }

  function parseCli(/*state*/) {
    var special = [
      'false', 'none', 'off', 'disable'
    , 'true', 'auto', 'on', 'enable'
    ];
    if (-1 !== argv.indexOf('init')) {
      RC.request({ service: 'list', method: 'POST', data: [] }, handleRemoteRequest('list'));
      return;
    }

    if ([ 'ssh', 'http', 'tcp' ].some(function (key) {
      if (key !== argv[0]) {
        return false;
      }
      if (argv[1]) {
        if (String(argv[1]) === String(parseInt(argv[1], 10))) {
          // looks like a port
          argv[1] = parseInt(argv[1], 10);
        } else if (/\/|\\/.test(argv[1])) {
          // looks like a path
          argv[1] = path.resolve(argv[1]);
          // TODO make a default assignment here
        } else if (-1 === special.indexOf(argv[1])) {
          console.error("Not sure what you meant by '" + argv[1] + "'.");
          console.error("Remember: paths should begin with ." + path.sep + ", like '." + path.sep + argv[1] + "'");
          return true;
        }
        RC.request({ service: argv[0], method: 'POST', data: argv.slice(1) }, handleRemoteRequest(argv[0]));
        return true;
      }
      help();
      return true;
    })) {
      return;
    }

    // Two styles:
    //     http 3000
    //     http modulename
    function makeRpc(key) {
      if (key !== argv[0]) {
        return false;
      }
      RC.request({ service: argv[0], method: 'POST', data: argv.slice(1) }, handleRemoteRequest(argv[0]));
      return true;
    }
    if ([ 'status', 'enable', 'disable', 'restart', 'list', 'save' ].some(makeRpc)) {
      return;
    }

    help();
    process.exit(11);
  }
  try {
    state._clientConfig = JSON.parse(text || '{}');
  } catch(e1) {
    try {
      state._clientConfig = YAML.safeLoad(text || '{}');
    } catch(e2) {
      try {
        state._clientConfig = TOML.parse(text || '');
      } catch(e3) {
        console.error(e1.message);
        console.error(e2.message);
        process.exit(1);
        return;
      }
    }
  }

  state._clientConfig = camelCopy(state._clientConfig || {}) || {};
  RC = require('../lib/rc/index.js').create(state);

  if (!Object.keys(state._clientConfig).length) {
    console.info('(' + state._ipc.comment + ": " + state._ipc.path + ')');
    console.info("");
  }

  if ((err && 'ENOENT' === err.code) || !Object.keys(state._clientConfig).length) {
    if (!err || 'ENOENT' === err.code) {
      //console.warn("Empty config file. Run 'telebit init' to configure.\n");
    } else {
      console.warn("Couldn't load config:\n\n\t" + err.message + "\n");
    }
  }

  function handleRemoteRequest(service, fn) {
    return function (err, body) {
      if ('function' === typeof fn) {
        fn(err, body); // XXX was resp
        return;
      }
      console.info("");
      if (err) {
        console.warn("'" + service + "' may have failed."
         + " Consider peaking at the logs either with 'journalctl -xeu telebit' or /opt/telebit/var/log/error.log");
        console.warn(err.statusCode, err.message);
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
        //console.info(TOML.stringify(body));
        console.info(YAML.safeDump(body));
      } else {
        if ('http' === body.module) {
          // TODO we'll support slingshot-ing in the future
          if (body.local) {
            if (String(body.local) === String(parseInt(body.local, 10))) {
              console.info('> Forwarding https://' + body.remote + ' => localhost:' + body.local);
            } else {
              console.info('> Serving ' + body.local + ' as https://' + body.remote);
            }
          } else {
            console.info('> Rejecting End-to-End Encrypted HTTPS for now');
          }
        } else if ('tcp' === body.module) {
          if (body.local) {
            console.info('> Forwarding ' + state.config.relay + ':' + body.remote + ' => localhost:' + body.local);
          } else {
            console.info('> Rejecting Legacy TCP');
          }
        } else if ('ssh' === body.module) {
          //console.info('> Forwarding ' + state.config.relay + ' -p ' + JSON.stringify(body) + ' => localhost:' + body.local);
          if (body.local) {
            console.info('> Forwarding ssh+https (openssl proxy) => localhost:' + body.local);
          } else {
            console.info('> Rejecting SSH-over-HTTPS for now');
          }
        } else if ('status' === body.module) {
          // TODO funny one this one
          console.info('http://localhost:' + (body.port || state.config.ipc.port));
          console.info(JSON.stringify(body, null, 2));
        } else {
          console.info(JSON.stringify(body, null, 2));
        }
        console.info();
      }
    };
  }

  function getToken(fn) {
    state.relay = state.config.relay;

    // { _otp, config: {} }
    common.api.token(state, {
      error: function (err/*, next*/) {
        console.error("[Error] common.api.token:");
        console.error(err);
        return;
      }
    , directory: function (dir, next) {
        //console.log('[directory] Telebit Relay Discovered:');
        //console.log(dir);
        state._apiDirectory = dir;
        next();
      }
    , tunnelUrl: function (tunnelUrl, next) {
        //console.log('[tunnelUrl] Telebit Relay Tunnel Socket:', tunnelUrl);
        state.wss = tunnelUrl;
        next();
      }
    , requested: function (authReq, next) {
        //console.log("[requested] Pairing Requested");
        state.config._otp = state.config._otp = authReq.otp;

        if (!state.config.token && state._can_pair) {
          console.info(TPLS.remote.code.replace(/0000/g, state.config._otp));
        }

        next();
      }
    , connect: function (pretoken, next) {
        //console.log("[connect] Enabling Pairing Locally...");
        state.config.pretoken = pretoken;
        state._connecting = true;

        // TODO use php-style object querification
        RC.request({ service: 'config', method: 'POST', data: state.config }, handleRemoteRequest('config', function (err/*, body*/) {
          if (err) {
            state._error = err;
            console.error("Error while initializing config [connect]:");
            console.error(err);
            return;
          }
          console.info("waiting...");
          next();
        }));
      }
    , offer: function (token, next) {
        //console.log("[offer] Pairing Enabled by Relay");
        state.config.token = token;
        if (state._error) {
          return;
        }
        state._connecting = true;
        try {
          require('jsonwebtoken').decode(token);
          //console.log(require('jsonwebtoken').decode(token));
        } catch(e) {
          console.warn("[warning] could not decode token");
        }
        RC.request({ service: 'config', method: 'POST', data: state.config }, handleRemoteRequest('config', function (err/*, body*/) {
          if (err) {
            state._error = err;
            console.error("Error while initializing config [offer]:");
            console.error(err);
            return;
          }
          //console.log("Pairing Enabled Locally");
          next();
        }));
      }
    , granted: function (_, next) {
        //console.log("[grant] Pairing complete!");
        next();
      }
    , end: function () {
        RC.request({ service: 'enable', method: 'POST', data: [] }, handleRemoteRequest('enable', function (err) {
          if (err) { console.error(err); return; }
          console.info("Success");

          // workaround for https://github.com/nodejs/node/issues/21319
          if (state._useTty) {
            setTimeout(function () {
              console.info("Some fun things to try first:\n");
              console.info("    ~/telebit http ~/public");
              console.info("    ~/telebit tcp 5050");
              console.info("    ~/telebit ssh auto");
              console.info();
              console.info("Press any key to continue...");
              console.info();
              process.exit(0);
            }, 0.5 * 1000);
            return;
          }
          // end workaround

          //parseCli(state);
          fn();
        }));
      }
    });
  }

  RC.request({ service: 'config', method: 'GET' }, handleRemoteRequest('config', handleConfig));
}

var parsers = {
  init: function (argv, parseCb) {
    var answers = {};
    var boolish = [ '--advanced' ];
    if ('init' !== argv[0]) {
      throw new Error("init must be the first argument");
    }
    argv.shift();

    // init --foo bar
    argv.forEach(function (arg, i) {
      if (!/^--/.test(arg)) { return; }
      if (-1 !== boolish.indexOf(arg)) {
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

    if (answers.relay) {
      console.info("using --relay " + answers.relay);
    }
    // things that aren't straight-forward copy-over
    if (!answers.advanced && !answers.relay) {
      answers.relay = 'telebit.cloud';
    }
    if (Array.isArray(common._NOTIFICATIONS[answers.update])) {
      common._NOTIFICATIONS[answers.update].forEach(function (name) {
        state.config[name] = true;
      });
    }
    if (answers.servernames) {
      state.config._servernames = answers.servernames;
    }
    if (answers.ports) {
      state.config._ports = answers.ports;
    }

    // things that are straight-forward copy-over
    common.CONFIG_KEYS.forEach(function (key) {
      if ('true' === answers[key]) { answers[key] = true; }
      if ('false' === answers[key]) { answers[key] = false; }
      if ('null' === answers[key]) { answers[key] = null; }
      if ('undefined' === answers[key]) { delete answers[key]; }
      if ('undefined' !== typeof answers[key]) {
        state.config[key] = answers[key];
      }
    });

    askForConfig(state, function (err, state) {
      if (err) { parseCb(err); return; }

      if (!state.config.token && state._can_pair) {
        state.config._otp = common.otp();
      }

      argv.unshift('init');
      parseCb(null, state);
    });
  }
};

fs.readFile(confpath, 'utf8', parseConfig);

}());

#!/usr/bin/env node
(function () {
'use strict';

var pkg = require('../package.json');

var url = require('url');
var path = require('path');
var os = require('os');
var fs = require('fs');
var urequest = require('@coolaj86/urequest');
var common = require('../lib/cli-common.js');
var http = require('http');
var YAML = require('js-yaml');
var recase = require('recase').create({});
var camelCopy = recase.camelCopy.bind(recase);
var snakeCopy = recase.snakeCopy.bind(recase);
var state = { homedir: os.homedir(), servernames: {}, ports: {} };

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

require('../lib/updater')(pkg);

function help() {
  console.info('');
  console.info('Telebit Daemon v' + pkg.version);
  console.info('');
  console.info('Usage:');
  console.info('');
  console.info('\ttelebitd --config <path>');
  console.info('\tex: telebitd --config ~/.config/telebit/telebitd.yml');
  console.info('');
  console.info('');
  console.info('Config:');
  console.info('');
  console.info('\tSee https://git.coolaj86.com/coolaj86/telebit.js');
  console.info('');
  console.info('');
}

var verstr = [ pkg.name + ' daemon v' + pkg.version ];
if (-1 === confIndex) {
  // We have two possible valid paths if no --config is given (i.e. run from an npm-only install)
  //   * {install}/etc/telebitd.yml
  //   * ~/.config/telebit/telebitd.yml
  // We'll asume the later since the installers include --config in the system launcher script
  confpath = path.join(state.homedir, '.config/telebit/telebitd.yml');
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
var tokenpath = path.join(path.dirname(confpath), 'access_token.txt');
var token;
try {
  token = require('fs').readFileSync(tokenpath, 'ascii').trim();
} catch(e) {
  // ignore
}
var controlServer;

var tun;

function serveControlsHelper() {
  controlServer = http.createServer(function (req, res) {
    var opts = url.parse(req.url, true);
    if (opts.query._body) {
      try {
        opts.body = JSON.parse(opts.query._body, true);
      } catch(e) {
        res.statusCode = 500;
        res.end('{"error":{"message":"?_body={{bad_format}}"}}');
        return;
      }
    }

    function listSuccess() {
      var dumpy = {
        servernames: state.servernames
      , ports: state.ports
      , ssh: state.config.sshAuto || 'disabled'
      , code: 'CONFIG'
      };
      if (state.otp) {
        dumpy.device_pair_code = state.otp;
      }

      if (state._can_pair && state.config.email && !state.token) {
        dumpy.code = "AWAIT_AUTH";
        dumpy.message = [
          "Check your email."
        , "You must verify your email address to activate this device."
        , ""
        , "    Device Pairing Code: " + state.otp
        ].join('\n');
      }

      res.end(JSON.stringify(dumpy));
    }

    function sshSuccess() {
      fs.writeFile(confpath, YAML.safeDump(snakeCopy(state.config)), function (err) {
        if (err) {
          res.statusCode = 500;
          res.end('{"error":{"message":"Could not save config file. Perhaps you\'re not running as root?"}}');
          return;
        }
        res.end('{"success":true}');
      });
    }

    //
    // without proper config
    //
    if (/\b(init|config)\b/.test(opts.pathname)) {
      var conf = {};
      var fresh;
      if (!opts.body) {
        res.statusCode = 422;
        res.end('{"error":{"message":"needs more arguments"}}');
        return;
      }
      // relay, email, agree_tos, servernames, ports
      //
      opts.body.forEach(function (opt) {
        var parts = opt.split(/:/);
        if ('true' === parts[1]) {
          parts[1] = true;
        } else if ('false' === parts[1]) {
          parts[1] = false;
        } else if ('null' === parts[1]) {
          parts[1] = null;
        } else if ('undefined' === parts[1]) {
          parts[1] = undefined;
        }
        conf[parts[0]] = parts[1];
      });
      if (!state.config.relay || !state.config.email || !state.config.agreeTos) {
        fresh = true;
      }

      // TODO camelCase query
      state.config.email = conf.email || state.config.email || '';
      if ('undefined' !== typeof conf.agree_tos) {
        state.config.agreeTos = conf.agree_tos;
      }
      state.otp = conf._otp || common.otp();
      state.config.relay = conf.relay || state.config.relay || '';
      state.config.token = conf.token || state.config.token || null;
      state.config.secret = conf.secret || state.config.secret || null;
      if ('undefined' !== typeof conf.newsletter) {
        state.config.newsletter = conf.newsletter;
      }
      if ('undefined' !== typeof conf.community_member) {
        state.config.communityMember = conf.community_member;
      }
      if ('undefined' !== typeof conf.telemetry) {
        state.config.telemetry = conf.telemetry;
      }
      if (conf.servernames) {
        (conf.servernames||'').split(/,/g).forEach(function (key) {
          if (!state.config.servernames[key]) {
            state.config.servernames[key] = {};
          }
        });
      }
      if (conf.ports) {
        (conf.ports||'').split(/,/g).forEach(function (key) {
          if (!state.config.ports[key]) {
            state.config.ports[key] = {};
          }
        });
      }

      if (!state.config.relay || !state.config.email || !state.config.agreeTos) {
        res.statusCode = 400;

        res.end(JSON.stringify({
          error: {
            code: "E_INIT"
          , message: "Missing important config file params"
          , _params: JSON.stringify(conf)
          , _config: JSON.stringify(state.config)
          , _body: JSON.stringify(opts.body)
          }
        }));
        return;
      }

      if (tun) {
        tun.end(function () {
          rawTunnel(saveAndReport);
        });
        tun = null;
        setTimeout(function () {
          if (!tun) {
            rawTunnel(saveAndReport);
          }
        }, 3000);
      } else {
        rawTunnel(saveAndReport);
      }

      function saveAndReport(err, _tun) {
        if (err) { throw err; }
        tun = _tun;
        fs.writeFile(confpath, YAML.safeDump(snakeCopy(state.config)), function (err) {
          if (err) {
            res.statusCode = 500;
            res.end('{"error":{"message":"Could not save config file after init: ' + err.message.replace(/"/g, "'")
              + '.\nPerhaps check that the file exists and your user has permissions to write it?"}}');
            return;
          }

          listSuccess();
        });
      }

      return;
    }

    if (/restart/.test(opts.pathname)) {
      tun.end();
      res.end('{"success":true}');
      controlServer.close(function () {
        // TODO closeAll other things
        process.nextTick(function () {
          // system daemon will restart the process
          process.exit(22); // use non-success exit code
        });
      });
      return;
    }

    //
    // Check for proper config
    //
    if (!state.config.relay || !state.config.email || !state.config.agreeTos) {
      res.statusCode = 400;
      res.end('{"error":{"code":"E_CONFIG","message":"Invalid config file. Please run \'telebit init\'"}}');
      return;
    }

    //
    // With proper config
    //
    if (/http/.test(opts.pathname)) {
      if (!opts.body) {
        res.statusCode = 422;
        res.end('{"error":{"message":"needs more arguments"}}');
        return;
      }
      if (opts.body[1]) {
        if (!state.servernames[opts.body[1]]) {
          res.statusCode = 400;
          res.end('{"error":{"message":"bad servername \'' + opts.body[1] + '\'"');
          return;
        }
        state.servernames[opts.body[1]].handler = opts.body[0];
      } else {
        Object.keys(state.servernames).forEach(function (key) {
          state.servernames[key].handler = opts.body[0];
        });
      }
      res.end('{"success":true}');
      return;
    }

    if (/tcp/.test(opts.pathname)) {
      if (!opts.body) {
        res.statusCode = 422;
        res.end('{"error":{"message":"needs more arguments"}}');
        return;
      }

      // portnum
      if (opts.body[1]) {
        if (!state.ports[opts.body[1]]) {
          res.statusCode = 400;
          res.end('{"error":{"message":"bad port \'' + opts.body[1] + '\'"');
          return;
        }
        // forward-to port-or-module
        state.ports[opts.body[1]].handler = opts.body[0];
      } else {
        Object.keys(state.ports).forEach(function (key) {
          state.ports[key].handler = opts.body[0];
        });
      }
      res.end('{"success":true}');
      return;
    }

    if (/save|commit/.test(opts.pathname)) {
      state.config.servernames = state.servernames;
      state.config.ports = state.ports;
      fs.writeFile(confpath, YAML.safeDump(snakeCopy(state.config)), function (err) {
        if (err) {
          res.statusCode = 500;
          res.end('{"error":{"message":"Could not save config file. Perhaps you\'re not running as root?"}}');
          return;
        }
        listSuccess();
      });
      return;
    }

    if (/ssh/.test(opts.pathname)) {
      var sshAuto;
      if (!opts.body) {
        res.statusCode = 422;
        res.end('{"error":{"message":"needs more arguments"}}');
        return;
      }

      sshAuto = opts.body[0];
      if (-1 !== [ 'false', 'none', 'off', 'disable' ].indexOf(sshAuto)) {
        state.config.sshAuto = false;
        sshSuccess();
        return;
      }
      if (-1 !== [ 'true', 'auto', 'on', 'enable' ].indexOf(sshAuto)) {
        state.config.sshAuto = 22;
        sshSuccess();
        return;
      }
      sshAuto = parseInt(sshAuto, 10);
      if (!sshAuto || sshAuto <= 0 || sshAuto > 65535) {
        res.statusCode = 400;
        res.end('{"error":{"message":"bad ssh_auto option \'' + opts.body[0] + '\'"');
        return;
      }
      state.config.sshAuto = sshAuto;
      sshSuccess();
      return;
    }

    if (/enable/.test(opts.pathname)) {
      delete state.config.disable;// = undefined;
      if (tun) {
        listSuccess();
        return;
      }
      rawTunnel(function (err, _tun) {
        if (err) { throw err; }
        tun = _tun;
        fs.writeFile(confpath, YAML.safeDump(snakeCopy(state.config)), function (err) {
          if (err) {
            res.statusCode = 500;
            res.end('{"error":{"message":"Could not save config file. Perhaps you\'re user doesn\'t have permission?"}}');
            return;
          }
          listSuccess();
        });
      });
      return;
    }

    if (/disable/.test(opts.pathname)) {
      state.config.disable = true;
      if (tun) { tun.end(); tun = null; }
      fs.writeFile(confpath, YAML.safeDump(snakeCopy(state.config)), function (err) {
        if (err) {
          res.statusCode = 500;
          res.end('{"error":{"message":"Could not save config file. Perhaps you\'re not running as root?"}}');
          return;
        }
        res.end('{"success":true}');
      });
      return;
    }

    if (/status/.test(opts.pathname)) {
      res.end(JSON.stringify(
        { status: (state.config.disable ? 'disabled' : 'enabled')
        , ready: ((state.config.relay && (state.config.token || state.config.agreeTos)) ? true : false)
        }
      ));
      return;
    }

    if (/list/.test(opts.pathname)) {
      listSuccess();
      return;
    }

    res.end('{"error":{"message":"unrecognized rpc"}}');
  });
  if (fs.existsSync(state._ipc.path)) {
    fs.unlinkSync(state._ipc.path);
  }
  // mask is so that processes owned by other users
  // can speak to this process, which is probably root-owned
  var oldUmask = process.umask(0x0000);
  controlServer.listen({
    path: state._ipc.path
  , writableAll: true
  , readableAll: true
  , exclusive: false
  }, function () {
    process.umask(oldUmask);
  });
}

function serveControls() {
  if (!state.config.disable) {
    if (state.config.relay && (state.config.token || state.config.agreeTos)) {
      rawTunnel(function (err, _tun) {
        if (err) { throw err; }
        tun = _tun;
        serveControlsHelper();
      });
      return;
    }
  }
  serveControlsHelper();
}

function parseConfig(err, text) {

  function run() {
    if (!state.config) {
      state.config = {};
    }
    state._ipc = common.pipename(state.config, true);
    console.info('');
    console.info(verstr.join(' '));
    if (!state.config.sock) {
      console.info('(' + state._ipc.comment + ': "' + state._ipc.path + '")');
    }
    console.info('');
    state.token = state.token || state.config.token || token;

    state._confpath = confpath;
    if (!state.config.servernames) {
      state.config.servernames = {};
    }
    if (!state.config.ports) {
      state.config.ports = {};
    }
    state.servernames = JSON.parse(JSON.stringify(state.config.servernames));
    state.ports = JSON.parse(JSON.stringify(state.config.ports));

    serveControls();
  }

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

  run();

  if ((err && 'ENOENT' === err.code) || !Object.keys(state.config).length) {
    if (!err || 'ENOENT' === err.code) {
      console.warn("Empty config file. Run 'telebit init' to configure.\n");
    } else {
      console.warn("Couldn't load config:\n\n\t" + err.message + "\n");
    }
  }
}

function rawTunnel(rawCb) {
  if (state.config.disable || !state.config.relay || !(state.config.token || state.config.agreeTos)) {
    rawCb(null, null);
    return;
  }

  state.relay = state.config.relay;
  if (!state.relay) {
    rawCb(new Error("'" + state._confpath + "' is missing 'relay'"));
    return;
  }

  common.api.token(state, {
    error: function (err/*, next*/) {
      console.error("[Error] common.api.token:");
      console.error(err);
      rawCb(err);
    }
  , directory: function (dir, next) {
      console.log('Telebit Relay Discovered:');
      state._apiDirectory = dir;
      console.log(dir);
      console.log();
      next();
    }
  , tunnelUrl: function (tunnelUrl, next) {
      console.log('Telebit Relay Tunnel Socket:', tunnelUrl);
      state.wss = tunnelUrl;
      next();
    }
  , requested: function (authReq, next) {
      console.log("Pairing Requested");
      var pin = authReq.pin || authReq.otp || authReq.pairCode;
      state.otp = state._otp = pin;
      state.auth = state.authRequest = state._auth = authReq;

      console.info();
      console.info('====================================');
      console.info('=           HEY! LISTEN!           =');
      console.info('====================================');
      console.info('=                                  =');
      console.info('= 1. CHECK YOUR EMAIL              =');
      console.info('=                                  =');
      console.info('= 2. DEVICE PAIRING CODE: 0000     ='.replace('0000', pin));
      console.info('=                                  =');
      console.info('====================================');
      console.info();

      next();
    }
  , connect: function (pretoken, next) {
      console.log("Enabling Pairing Locally...");
      connectTunnel(pretoken, function (err, _tun) {
        console.log("Pairing Enabled Locally");
        tun = _tun;
        next();
      });
    }
  , offer: function (token, next) {
      console.log("Pairing Enabled by Relay");
      state.token = token;
      state.config.token = token;
      state.handlers.access_token({ jwt: token });
      if (tun) {
        tun.append(token);
      } else {
        connectTunnel(token, function (err, _tun) {
          tun = _tun;
        });
      }
      next();
    }
  , granted: function (token, next) {
      console.log("Relay-Remote Pairing Complete");
      next();
    }
  , end: function () {
      rawCb(null, tun);
    }
  });
}

function connectTunnel(token, cb) {
  if (tun) {
    cb(null, tun);
    return;
  }
  state.greenlockConf = state.config.greenlock || {};
  state.sortingHat = state.config.sortingHat;

  // TODO sortingHat.print(); ?
  // TODO Check undefined vs false for greenlock config
  var remote = require('../');

  state.greenlockConfig = {
    version: state.greenlockConf.version || 'draft-11'
  , server: state.greenlockConf.server || 'https://acme-v02.api.letsencrypt.org/directory'
  , communityMember: state.greenlockConf.communityMember || state.config.communityMember
  , telemetry: state.greenlockConf.telemetry || state.config.telemetry
  , configDir: state.greenlockConf.configDir || path.resolve(__dirname, '..', 'etc/acme/')
  // TODO, store: require(state.greenlockConf.store.name || 'le-store-certbot').create(state.greenlockConf.store.options || {})
  , approveDomains: function (opts, certs, cb) {
      // Certs being renewed are listed in certs.altnames
      if (certs) {
        opts.domains = certs.altnames;
        cb(null, { options: opts, certs: certs });
        return;
      }

      // by virtue of the fact that it's being tunneled through a
      // trusted source that is already checking, we're good
      //if (-1 !== state.config.servernames.indexOf(opts.domains[0])) {
        opts.email = state.greenlockConf.email || state.config.email;
        opts.agreeTos = state.greenlockConf.agree || state.greenlockConf.agreeTos || state.config.agreeTos;
        cb(null, { options: opts, certs: certs });
        return;
      //}

      //cb(new Error("servername not found in allowed list"));
    }
  };
  state.insecure = state.config.relay_ignore_invalid_certificates;
  // { relay, config, servernames, ports, sortingHat, net, insecure, token, handlers, greenlockConfig }

  tun = remote.connect({
    relay: state.relay
  , wss: state.wss
  , config: state.config
  , otp: state.otp
  , sortingHat: state.sortingHat
  , net: state.net
  , insecure: state.insecure
  , token: token // instance
  , servernames: state.servernames
  , ports: state.ports
  , handlers: state.handlers
  , greenlockConfig: state.greenlockConfig
  });

  cb(null, tun);
}

state.handlers = {
  grant: function (grants) {
    console.info("");
    console.info("Connect to your device by any of the following means:");
    console.info("");
    grants.forEach(function (arr) {
      if ('https' === arr[0]) {
        if (!state.servernames[arr[1]]) {
          state.servernames[arr[1]] = {};
        }
      } else if ('tcp' === arr[0]) {
        if (!state.ports[arr[2]]) {
          state.ports[arr[2]] = {};
        }
      }

      if ('ssh+https' === arr[0]) {
        console.info("SSH+HTTPS");
      } else if ('ssh' === arr[0]) {
        console.info("SSH");
      } else if ('tcp' === arr[0]) {
        console.info("TCP");
      } else if ('https' === arr[0]) {
        console.info("HTTPS");
      }
      console.info('\t' + arr[0] + '://' + arr[1] + (arr[2] ? (':' + arr[2]) : ''));
      if ('ssh+https' === arr[0]) {
        console.info("\tex: ssh -o ProxyCommand='openssl s_client -connect %h:%p -servername %h -quiet' " + arr[1] + " -p 443\n");
      } else if ('ssh' === arr[0]) {
        console.info("\tex: ssh " + arr[1] + " -p " + arr[2] + "\n");
      } else if ('tcp' === arr[0]) {
        console.info("\tex: netcat " + arr[1] + " " + arr[2] + "\n");
      } else if ('https' === arr[0]) {
        console.info("\tex: curl https://" + arr[1] + "\n");
      }
    });
  }
, access_token: function (opts) {
    state.token = opts.jwt;
    state.config.token = opts.jwt;
    console.info("Updating '" + tokenpath + "' with new token:");
    try {
      require('fs').writeFileSync(tokenpath, opts.jwt);
    } catch (e) {
      console.error("Token not saved:");
      console.error(e);
    }
  }
};

function sigHandler() {
  console.info('Received kill signal. Attempting to exit cleanly...');

  // We want to handle cleanup properly unless something is broken in our cleanup process
  // that prevents us from exitting, in which case we want the user to be able to send
  // the signal again and exit the way it normally would.
  process.removeListener('SIGINT', sigHandler);
  if (tun) {
    tun.end();
  }
  controlServer.close();
}
// reverse 2FA otp

process.on('SIGINT', sigHandler);

state.net = state.net || {
  createConnection: function (info, cb) {
    // data is the hello packet / first chunk
    // info = { data, servername, port, host, remoteFamily, remoteAddress, remotePort }
    var net = require('net');
    // socket = { write, push, end, events: [ 'readable', 'data', 'error', 'end' ] };
    var socket = net.createConnection({ port: info.port, host: info.host }, cb);
    return socket;
  }
};

require('fs').readFile(confpath, 'utf8', parseConfig);

}());

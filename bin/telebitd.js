#!/usr/bin/env node
(function () {
'use strict';

var PromiseA;
try {
  PromiseA = require('bluebird');
} catch(e) {
  PromiseA = global.Promise;
}

var pkg = require('../package.json');

var url = require('url');
var path = require('path');
var os = require('os');
var fs = require('fs');
var common = require('../lib/cli-common.js');
var http = require('http');
var YAML = require('js-yaml');
var recase = require('recase').create({});
var camelCopy = recase.camelCopy.bind(recase);
var snakeCopy = recase.snakeCopy.bind(recase);
var TelebitRemote = require('../').TelebitRemote;

var state = { homedir: os.homedir(), servernames: {}, ports: {}, keepAlive: true };

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

var cancelUpdater = require('../lib/updater')(pkg);

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
  confpath = common.DEFAULT_CONFIG_PATH;
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

state._confpath = confpath;
var tokenpath = path.join(path.dirname(state._confpath), 'access_token.txt');
var token;
try {
  token = fs.readFileSync(tokenpath, 'ascii').trim();
  console.log('[DEBUG] access_token', typeof token, token);
} catch(e) {
  // ignore
}
var controlServer;
var myRemote;

function getServername(servernames, sub) {
  if (state.servernames[sub]) {
    return sub;
  }

  var names = Object.keys(servernames).map(function (servername) {
    if ('*.' === servername.slice(0,2)) {
      return servername;
    }
    return '*.' + servername;
  }).sort(function (a, b) {
    return b.length - a.length;
  });

  return names.filter(function (pattern) {
    // '.example.com' = '*.example.com'.split(1)
    var subPiece = pattern.slice(1);
    // '.com' = 'sub.example.com'.slice(-4)
    // '.example.com' = 'sub.example.com'.slice(-12)
    if (subPiece === sub.slice(-subPiece.length)) {
      return subPiece;
    }
  })[0];
}

function saveConfig(cb) {
  fs.writeFile(confpath, YAML.safeDump(snakeCopy(state.config)), cb);
}
var controllers = {};
controllers.http = function (req, res, opts) {
  function getAppname(pathname) {
    // port number
    if (String(pathname) === String(parseInt(pathname, 10))) {
      return String(pathname);
    }
    var paths = pathname.split(/[\\\/\:]/);
    // rid trailing slash(es)
    while (!paths[paths.length -1]) {
      paths.pop();
    }
    var name = paths.pop();
    name = path.basename(name, path.extname(name));
    name = name.replace(/\./, '-').replace(/-+/, '-');
    return name;
  }
  if (!opts.body) {
    res.statusCode = 422;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({"error":{"message":"module \'http\' needs more arguments"}}));
    return;
  }
  var active = true;
  var portOrPath = opts.body[0];
  var appname = getAppname(portOrPath);
  var subdomain = opts.body[1];
  var remoteHost;

  // Assign an FQDN to brief subdomains
  // ex: foo => foo.rando.telebit.cloud
  if (subdomain && !/\./.test(subdomain)) {
    Object.keys(state.servernames).some(function (key) {
      if (state.servernames[key].wildcard) {
        subdomain += '.' + key;
      }
    });
  }

  if ('none' === portOrPath || 'none' === subdomain) {
    // ~/telebit http none                  // turn off all
    // ~/telebit http none none             // (same as above)
    // ~/telebit http 3000 none             // turn off this handler
    // ~/telebit http none sub.example.com  // turn off this subdomain
    // ~/telebit http none sub              // TODO
    Object.keys(state.servernames).forEach(function (key) {
      if ('none' === portOrPath && 'none' === subdomain) {
        delete state.servernames[key].handler;
        return;
      }
      if (state.servernames[key].handler === portOrPath) {
        delete state.servernames[key].handler;
        return;
      }
      if (!subdomain || key === subdomain) {
        if (state.servernames[key].sub) {
          delete state.servernames[key];
        } else {
          delete state.servernames[key].handler;
        }
        return;
      }
    });
    delete state.servernames[subdomain];
    remoteHost = 'none';
  } else if (subdomain && 'none' !== subdomain) {
    // use a subdomain with this handler
    var handlerName = getServername(state.servernames, subdomain);
    if (!handlerName) {
      active = false;
    }
    if (!state.servernames[subdomain]) {
      state.servernames[subdomain] = { sub: true };
    }
    if ('none' === portOrPath) {
      delete state.servernames[subdomain].handler;
    } else {
      state.servernames[subdomain].handler = portOrPath;
    }
    remoteHost = subdomain;
  } else {
    // just replace the default domain
    if (!Object.keys(state.servernames).sort(function (a, b) {
      return b.length - a.length;
    }).some(function (key) {
      if (state.servernames[key].handler === appname) {
        // example.com.handler: 3000 // already set
        remoteHost = key;
        return true;
      }
      if (state.servernames[key].wildcard) {
        //var prefix = appname + '.' + key;
        var prefix = key;
        if (!state.servernames[prefix]) {
          state.servernames[prefix] = { sub: undefined };
        }
        state.servernames[prefix].handler = portOrPath;
        remoteHost = prefix;
        return true;
      }
    })) {
      Object.keys(state.servernames).some(function (key) {
        //var prefix = appname + '.' + key;
        var prefix = key;
        state.servernames[key].handler = portOrPath;
        remoteHost = prefix;
        return true;
      });
    }
  }
  state.config.servernames = state.servernames;
  saveConfig(function (err) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      success: true
    , active: active
    , remote: remoteHost
    , local: portOrPath
    , saved: !err
    , module: 'http'
    }));
  });
};
controllers.tcp = function (req, res, opts) {
  if (!opts.body) {
    res.statusCode = 422;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { message: "module 'tcp' needs more arguments" } }));
    return;
  }

  var active;
  var remotePort = opts.body[1];
  var portOrPath = opts.body[0];

  // portnum
  if (remotePort) {
    if (!state.ports[remotePort]) {
      active = false;
      return;
    }
    // forward-to port-or-module
    // TODO we can't send files over tcp until we fix the connect event bug
    state.ports[remotePort].handler = portOrPath;
  } else {
    if (!Object.keys(state.ports).some(function (key) {
      if (!state.ports[key].handler) {
        state.ports[key].handler = portOrPath;
        remotePort = key;
        return true;
      }
    })) {
      Object.keys(state.ports).some(function (key) {
        state.ports[key].handler = portOrPath;
        remotePort = key;
        return true;
      });
    }
  }
  state.config.ports = state.ports;
  saveConfig(function (err) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      success: true
    , active: active
    , remote: remotePort
    , local: portOrPath
    , saved: !err
    , module: 'tcp'
    }));
  });
};
controllers.ssh = function (req, res, opts) {
  if (!opts.body) {
    res.statusCode = 422;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({"error":{"message":"module 'ssh' needs more arguments"}}));
    return;
  }

  function sshSuccess() {
    //state.config.sshAuto = state.sshAuto;
    saveConfig(function (err) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        success: true
      , active: true
      , remote: Object.keys(state.config.ports)[0]
      , local: state.config.sshAuto || 22
      , saved: !err
      , module: 'ssh'
      }));
    });
  }

  var sshAuto = opts.body[0];
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
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { message: "bad ssh_auto option '" + opts.body[0] + "'" } }));
    return;
  }
  state.config.sshAuto = sshAuto;
  sshSuccess();
};
function serveControlsHelper() {
  controlServer = http.createServer(function (req, res) {
    var opts = url.parse(req.url, true);
    if (opts.query._body) {
      try {
        opts.body = JSON.parse(decodeURIComponent(opts.query._body, true));
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
        dumpy.message = "Please run 'telebit init' to authenticate.";
      }

      res.end(JSON.stringify(dumpy));
    }

    function getConfigOnly() {
      var resp = JSON.parse(JSON.stringify(state.config));
      resp.version = pkg.version;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(resp));
    }

    //
    // without proper config
    //
    function saveAndReport() {
      console.log('[DEBUG] saveAndReport config write', confpath);
      console.log(YAML.safeDump(snakeCopy(state.config)));
      fs.writeFile(confpath, YAML.safeDump(snakeCopy(state.config)), function (err) {
        if (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end('{"error":{"message":"Could not save config file after init: ' + err.message.replace(/"/g, "'")
            + '.\nPerhaps check that the file exists and your user has permissions to write it?"}}');
          return;
        }

        listSuccess();
      });
    }

    function initOrConfig() {
      var conf = {};
      if (!opts.body) {
        res.statusCode = 422;
        res.end('{"error":{"message":"module \'init\' needs more arguments"}}');
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

      // TODO camelCase query
      state.config.email = conf.email || state.config.email || '';
      if ('undefined' !== typeof conf.agreeTos
        || 'undefined' !== typeof conf.agreeTos ) {
        state.config.agreeTos = conf.agreeTos || conf.agree_tos;
      }
      state.otp = conf._otp; // this should only be done on the client side
      state.config.relay = conf.relay || state.config.relay || '';
      console.log();
      console.log('conf.token', typeof conf.token, conf.token);
      console.log('state.config.token', typeof state.config.token, state.config.token);
      state.config.token = conf.token || state.config.token || null;
      state.config.secret = conf.secret || state.config.secret || null;
      state.pretoken = conf.pretoken || state.config.pretoken || null;
      if (state.secret) {
        console.log('state.secret');
        state.token = common.signToken(state);
      }
      if (!state.token) {
        console.log('!state.token');
        state.token = conf._token;
      }
      console.log();
      console.log('JSON.stringify(conf)');
      console.log(JSON.stringify(conf));
      console.log();
      console.log('JSON.stringify(state)');
      console.log(JSON.stringify(state));
      console.log();
      if ('undefined' !== typeof conf.newsletter) {
        state.config.newsletter = conf.newsletter;
      }
      if ('undefined' !== typeof conf.communityMember
        || 'undefined' !== typeof conf.community_member) {
        state.config.communityMember = conf.communityMember || conf.community_member;
      }
      if ('undefined' !== typeof conf.telemetry) {
        state.config.telemetry = conf.telemetry;
      }
      if (conf._servernames) {
        (conf._servernames||'').split(/,/g).forEach(function (key) {
          if (!state.config.servernames[key]) {
            state.config.servernames[key] = { sub: undefined };
          }
        });
      }
      if (conf._ports) {
        (conf._ports||'').split(/,/g).forEach(function (key) {
          if (!state.config.ports[key]) {
            state.config.ports[key] = {};
          }
        });
      }

      if (!state.config.relay || !state.config.email || !state.config.agreeTos) {
        console.log('aborting for some reason');
        res.statusCode = 400;

        res.setHeader('Content-Type', 'application/json');
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

      // init also means enable
      delete state.config.disable;
      safeStartTelebitRemote(true).then(saveAndReport).catch(handleError);
    }

    function restart() {
      // failsafe
      setTimeout(function () {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
        setTimeout(function () {
          process.exit(33);
        }, 500);
      }, 5 * 1000);

      if (myRemote) { myRemote.end(); }
      controlServer.close(function () {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));

        setTimeout(function () {
          // system daemon will restart the process
          process.exit(22); // use non-success exit code
        }, 500);
      });
    }

    function invalidConfig() {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: { code: "E_CONFIG", message: "Invalid config file. Please run 'telebit init'" }
      }));
    }

    function saveAndCommit() {
      state.config.servernames = state.servernames;
      state.config.ports = state.ports;
      fs.writeFile(confpath, YAML.safeDump(snakeCopy(state.config)), function (err) {
        if (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            "error":{"message":"Could not save config file. Perhaps you're not running as root?"}
          }));
          return;
        }
        listSuccess();
      });
    }

    function handleError(err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: { message: err.message, code: err.code }
      }));
    }

    function enable() {
      delete state.config.disable;// = undefined;
      state.keepAlive = true;

      // TODO XXX myRemote.active
      if (myRemote) {
        listSuccess();
        return;
      }
      fs.writeFile(confpath, YAML.safeDump(snakeCopy(state.config)), function (err) {
        if (err) {
          err.message = "Could not save config file. Perhaps you're user doesn't have permission?";
          handleError(err);
          return;
        }
        safeStartTelebitRemote(true).then(listSuccess).catch(handleError);
      });
    }

    function disable() {
      state.config.disable = true;
      state.keepAlive = false;

      if (myRemote) { myRemote.end(); myRemote = null; }
      fs.writeFile(confpath, YAML.safeDump(snakeCopy(state.config)), function (err) {
        res.setHeader('Content-Type', 'application/json');
        if (err) {
          err.message = "Could not save config file. Perhaps you're user doesn't have permission?";
          handleError(err);
          return;
        }
        res.end('{"success":true}');
      });
    }

    function getStatus() {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(
        { status: (state.config.disable ? 'disabled' : 'enabled')
        , ready: ((state.config.relay && (state.config.token || state.config.agreeTos)) ? true : false)
        , active: !!myRemote
        , connected: 'maybe (todo)'
        , version: pkg.version
        , servernames: state.servernames
        }
      ));
    }

    if (/\b(config)\b/.test(opts.pathname) && /get/i.test(req.method)) {
      getConfigOnly();
      return;
    }
    if (/\b(init|config)\b/.test(opts.pathname)) {
      initOrConfig();
      return;
    }
    if (/restart/.test(opts.pathname)) {
      restart();
      return;
    }
    //
    // Check for proper config
    //
    if (!state.config.relay || !state.config.email || !state.config.agreeTos) {
      invalidConfig();
      return;
    }
    //
    // With proper config
    //
    if (/http/.test(opts.pathname)) {
      controllers.http(req, res, opts);
      return;
    }
    if (/tcp/.test(opts.pathname)) {
      controllers.tcp(req, res, opts);
      return;
    }
    if (/save|commit/.test(opts.pathname)) {
      saveAndCommit();
      return;
    }
    if (/ssh/.test(opts.pathname)) {
      controllers.ssh(req, res, opts);
      return;
    }
    if (/enable/.test(opts.pathname)) {
      enable();
      return;
    }
    if (/disable/.test(opts.pathname)) {
      disable();
      return;
    }
    if (/status/.test(opts.pathname)) {
      getStatus();
      return;
    }
    if (/list/.test(opts.pathname)) {
      listSuccess();
      return;
    }

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({"error":{"message":"unrecognized rpc"}}));
  });

  if (fs.existsSync(state._ipc.path)) {
    fs.unlinkSync(state._ipc.path);
  }
  // mask is so that processes owned by other users
  // can speak to this process, which is probably root-owned
  var oldUmask = process.umask(0x0000);
  var serverOpts = {
    writableAll: true
  , readableAll: true
  , exclusive: false
  };
  if ('socket' === state._ipc.type) {
    require('mkdirp').sync(path.dirname(state._ipc.path));
  }
  // https://nodejs.org/api/net.html#net_server_listen_options_callback
  // path is ignore if port is defined
  // https://git.coolaj86.com/coolaj86/telebit.js/issues/23#issuecomment-326
  if (state._ipc.port) {
    serverOpts.host = 'localhost';
    serverOpts.port = state._ipc.port;
  } else {
    serverOpts.path = state._ipc.path;
  }
  controlServer.listen(serverOpts, function () {
    process.umask(oldUmask);
    var address = this.address();
    if (address.port) {
      common.setPort(state.config, address.port);
    }
    //console.log(this.address());
    console.info("[info] Listening for commands on", address);
  });
}

function serveControls() {
  serveControlsHelper();

  if (state.config.disable) {
    console.info("[info] starting disabled");
    return;
  }

  // This will remain in a disconnect state and wait for an init
  if (!(state.config.relay && (state.config.token || state.config.pretoken))) {
    console.info("[info] waiting for init/authentication (missing relay and/or token)");
    return;
  }

  console.info("[info] connecting with stored token");
  state.keepAlive = true;
  return safeStartTelebitRemote().catch(function (/*err*/) {
    // ignore, it'll keep looping anyway
  });
}

function parseConfig(err, text) {

  function run() {
    if (!state.config) {
      state.config = {};
    }
    common._init(
      state.config.root || path.join(os.homedir(), '.local/share/telebit') // || path.join(__dirname, '..')
    , (state.config.root && path.join(state.config.root, 'etc')) || path.resolve(common.DEFAULT_CONFIG_PATH, '..')
    );
    state._ipc = common.pipename(state.config, true);
    console.info('');
    console.info(verstr.join(' '));
    if (!state.config.sock) {
      console.info('(' + state._ipc.comment + ': "' + state._ipc.path + '")');
    }
    console.info('');
    state.token = state.token || state.config.token || token;
    state.pretoken = state.pretoken || state.config.pretoken;

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

function approveDomains(opts, certs, cb) {
  // Even though it's being tunneled by a trusted source
  // we need to make sure we don't get rate-limit spammed
  // with wildcard domains
  // TODO: finish implementing dynamic dns for wildcard certs
  if (getServername(state.servernames, opts.domains[0])) {
    opts.email = state.greenlockConf.email || state.config.email;
    opts.agreeTos = state.greenlockConf.agree || state.greenlockConf.agreeTos || state.config.agreeTos;
    cb(null, { options: opts, certs: certs });
    return;
  }

  cb(new Error("servername not found in allowed list"));
}

function greenlockHelper(state) {
  // TODO Check undefined vs false for greenlock config
  state.greenlockConf = state.config.greenlock || {};
  state.greenlockConfig = {
    version: state.greenlockConf.version || 'draft-11'
  , server: state.greenlockConf.server || 'https://acme-v02.api.letsencrypt.org/directory'
  , communityMember: state.greenlockConf.communityMember || state.config.communityMember
  , telemetry: state.greenlockConf.telemetry || state.config.telemetry
  , configDir: state.greenlockConf.configDir
      || (state.config.root && path.join(state.config.root, 'etc/acme'))
      || path.join(os.homedir(), '.config/telebit/acme')
  // TODO, store: require(state.greenlockConf.store.name || 'le-store-certbot').create(state.greenlockConf.store.options || {})
  , approveDomains: approveDomains
  };
  state.insecure = state.config.relay_ignore_invalid_certificates;
}

function promiseTimeout(t) {
  return new PromiseA(function (resolve) {
    setTimeout(resolve, t);
  });
}

var promiseWss = PromiseA.promisify(function (state, fn) {
  return common.api.wss(state, fn);
});

var trPromise;
function safeStartTelebitRemote() {
  state.keepAlive = false;
  if (trPromise) {
    return trPromise;
  }

  trPromise = rawStartTelebitRemote();
  trPromise.then(function () {
    state.keepAlive = true;
    trPromise = null;
  }).catch(function () {
    state.keepAlive = true;
    trPromise = rawStartTelebitRemote();
    trPromise.then(function () {
      state.keepAlive = true;
      trPromise = null;
    }).catch(function () {
      state.keepAlive = true;
      console.log('DEBUG state.keepAlive turned off and remote quit');
      trPromise = null;
    });
  });
  return trPromise;
}

function rawStartTelebitRemote() {
  var err;
  var exiting = false;
  var localRemote = myRemote;
  myRemote = null;
  if (localRemote) { console.log('DEBUG destroy() existing'); localRemote.destroy(); }

  function safeReload(delay) {
    if (exiting) {
      // return a junk promise as the prior call
      // already passed flow-control to the next promise
      // (this is a second or delayed error or close event)
      return PromiseA.resolve();
    }
    exiting = true;
    // TODO state.keepAlive?
    return promiseTimeout(delay).then(rawStartTelebitRemote);
  }

  if (state.config.disable) {
    console.log('DEBUG disabled or incapable');
    err = new Error("connecting is disabled");
    err.code = 'EDISABLED';
    return PromiseA.reject(err);
  }

  if (!(state.config.token || state.config.agreeTos)) {
    console.log('DEBUG Must agreeTos to generate preauth');
    err = new Error("Must either supply token (for auth) or agreeTos (for preauth)");
    err.code = 'ENOAGREE';
    return PromiseA.reject(err);
  }

  state.relay = state.config.relay;
  if (!state.relay) {
    console.log('DEBUG no relay');
    err = new Error("'" + state._confpath + "' is missing 'relay'");
    err.code = 'ENORELAY';
    return PromiseA.reject(err);
  }

  // TODO: we need some form of pre-authorization before connecting,
  // otherwise we'll get disconnected pretty quickly
  if (!(state.token || state.pretoken)) {
    console.log('DEBUG no token');
    err = new Error("no jwt token or preauthorization");
    err.code = 'ENOAUTH';
    return PromiseA.reject(err);
  }

  return PromiseA.resolve().then(function () {
    console.log('DEBUG rawStartTelebitRemote');

    function startHelper() {
      console.log('DEBUG startHelper');
      greenlockHelper(state);
      // Saves the token
      // state.handlers.access_token({ jwt: token });
      // Adds the token to the connection
      // tun.append(token);

      console.log("[DEBUG] token", typeof token, token);
      //state.sortingHat = state.config.sortingHat;
      // { relay, config, servernames, ports, sortingHat, net, insecure, token, handlers, greenlockConfig }

      return new PromiseA(function (myResolve, myReject) {
        function reject(err) {
          if (myReject) {
            myReject(err);
            myResolve = null;
            myReject = null;
          } else {
            console.log('DEBUG double rejection');
          }
        }
        function resolve(val) {
          if (myResolve) {
            myResolve(val);
            myResolve = null;
            myReject = null;
          } else {
            console.log('DEBUG double resolution');
          }
        }

        function onConnect() {
          console.log('DEBUG on connect');
          myRemote.removeListener('error', onConnectError);
          myRemote.once('error', function () {
            if (!state.keepAlive) {
              reject(err);
              return;
            }
            retryLoop();
          });
          resolve(myRemote);
          return;
        }

        function onConnectError(err) {
          myRemote = null;
          console.log('DEBUG onConnectError (will safeReload)', err);
          // Likely causes:
          //   * DNS lookup failed (no Internet)
          //   * Rejected (bad authn)
          if ('ENOTFOUND' === err.code) {
            // DNS issue, probably network is disconnected
            if (!state.keepAlive) {
              reject(err);
              return;
            }
            safeReload(10 * 1000).then(resolve).catch(reject);
            return;
          }
          reject(err);
          return;
        }

        function retryLoop() {
          console.log('DEBUG retryLoop (will safeReload)');
          if (state.keepAlive) {
            safeReload(10 * 1000).then(resolve).catch(reject);
          }
        }

        myRemote = TelebitRemote.createConnection({
          relay: state.relay
        , wss: state.wss
        , config: state.config
        , otp: state.otp
        , sortingHat: state.config.sortingHat
        , net: state.net
        , insecure: state.insecure
        , token: state.token || state.pretoken // instance
        , servernames: state.servernames
        , ports: state.ports
        , handlers: state.handlers
        , greenlockConfig: state.greenlockConfig
        }, onConnect);

        myRemote.once('error', onConnectError);
        myRemote.once('close', retryLoop);
        myRemote.on('grant', state.handlers.grant);
        myRemote.on('access_token', state.handlers.access_token);
      });
    }

    if (state.wss) {
      return startHelper();
    }

    // get the wss url
    function retryWssLoop(err) {
      if (!state.keepAlive) {
        return PromiseA.reject(err);
      }

      myRemote = null;
      if (!err) {
        return startHelper();
      }

      if ('ENOTFOUND' === err.code) {
        // The internet is disconnected
        // try again, and again, and again
        return safeReload(2 * 1000);
      }

      return PromiseA.reject(err);
    }

    return promiseWss(state).then(function (wss) {
      state.wss = wss;
      return startHelper();
    }).catch(function (err) {
      return retryWssLoop(err);
    });
  });
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
        state.servernames[arr[1]].wildcard = true;
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
    if ('undefined' === opts.jwt || !opts.jwt) {
      console.error("Granted empty access token... ??");
      console.error(JSON.stringify(opts));
      return;
    }
    state.token = opts.jwt || opts.access_token;
    state.config.token = opts.jwt || opts.access_token;
    console.info("Updating '" + tokenpath + "' with new token:");
    try {
      fs.writeFileSync(tokenpath, opts.jwt);
      fs.writeFileSync(confpath, YAML.safeDump(snakeCopy(state.config)));
    } catch (e) {
      console.error("Token not saved:");
      console.error(e);
    }
  }
};

function sigHandler() {
  console.info('Received kill signal. Attempting to exit cleanly...');
  state.keepAlive = false;

  // We want to handle cleanup properly unless something is broken in our cleanup process
  // that prevents us from exitting, in which case we want the user to be able to send
  // the signal again and exit the way it normally would.
  process.removeListener('SIGINT', sigHandler);
  if (myRemote) {
    myRemote.end();
  }
  if (controlServer) {
    controlServer.close();
  }
  cancelUpdater();
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

fs.readFile(confpath, 'utf8', parseConfig);

}());

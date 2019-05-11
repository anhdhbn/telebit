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
var Keypairs = require('keypairs');

var crypto = require('crypto');
//var url = require('url');
var path = require('path');
var os = require('os');
var fs = require('fs');
var fsp = fs.promises;
var urequest = require('@root/request');
var urequestAsync = require('util').promisify(urequest);
var common = require('../lib/cli-common.js');
var http = require('http');
var TOML = require('toml');
var YAML = require('js-yaml');
var recase = require('recase').create({});
var camelCopy = recase.camelCopy.bind(recase);
var snakeCopy = recase.snakeCopy.bind(recase);
var TPLS = TOML.parse(fs.readFileSync(path.join(__dirname, "../lib/en-us.toml"), 'utf8'));
var startTime = Date.now();
var connectTimes = [];
var isConnected = false;
var eggspress = require('../lib/eggspress.js');
var keypairs = require('keypairs');
var KEYEXT = '.key.jwk.json';
var PUBEXT = '.pub.jwk.json';

var TelebitRemote = require('../lib/daemon/index.js').TelebitRemote;

var state = { homedir: os.homedir(), servernames: {}, ports: {}, keepAlive: { state: false } };

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
  console.info(TPLS.daemon.help.main.replace(/{version}/g, pkg.version));
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
var keystore = require('../lib/keystore.js').create({
  name: "Telebit Daemon"
, configDir: path.basename(confpath)
});

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

/*global Promise*/
var _savingConfig = Promise.resolve();
function saveConfig(cb) {
  // simple sequencing chain so that write corruption is not possible
  _savingConfig = _savingConfig.then(function () {
    return fsp.writeFile(confpath, YAML.safeDump(snakeCopy(state.config))).then(function () {
      try {
        cb();
      } catch(e) {
        console.error(e.stack);
        process.exit(47);
      }
    }).catch(cb);
  });
}
var controllers = {};
controllers.http = function (req, res) {
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

  function assign(target, handler, indexes) {
    target.handler = handler;
    if (indexes) {
      target.indexes = true;
    } else {
      delete target.indexes;
    }
  }

  if (!req.body) {
    res.statusCode = 422;
    res.send({"error":{"message":"module \'http\' needs some arguments"}});
    return;
  }

  var active = true;
  var portOrPath = req.body.handler || req.body[0];
  var subdomain = req.body.name || req.body[1];
  var indexes = req.body.indexes;
  var remoteHost;

  if (!portOrPath) {
    res.statusCode = 422;
    res.send({ error: { message: "module 'http' needs port or path" } });
    return;
  }

  var appname = getAppname(portOrPath);

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
    if (state.servernames[subdomain]) {
      // TODO remove all non-essential keys
      delete state.servernames[subdomain].handler;
      if (state.servernames[subdomain].sub) {
        delete state.servernames[subdomain];
      }
    }
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
      assign(state.servernames[subdomain], portOrPath, indexes);
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
        assign(state.servernames[prefix], portOrPath, indexes);
        remoteHost = prefix;
        return true;
      }
    })) {
      Object.keys(state.servernames).some(function (key) {
        //var prefix = appname + '.' + key;
        var prefix = key;
        assign(state.servernames[key], portOrPath, indexes);
        remoteHost = prefix;
        return true;
      });
    }
  }
  state.config.servernames = state.servernames;
  saveConfig(function (err) {
    res.send({
      success: true
    , active: active
    , remote: remoteHost
    , local: portOrPath
    , saved: !err
    , module: 'http'
    });
  });
};
controllers.tcp = function (req, res) {
  if (!req.body) {
    res.statusCode = 422;
    res.send({ error: { message: "module 'tcp' needs more arguments" } });
    return;
  }

  var active;
  var remotePort = req.body[1];
  var portOrPath = req.body[0];

  // portnum
  if (remotePort) {
    if (!state.ports[remotePort]) {
      active = false;
    } else {
      // forward-to port-or-module
      // TODO with the connect event bug fixed, we should now be able to send files over tcp
      state.ports[remotePort].handler = portOrPath;
    }
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
    res.send({
      success: true
    , active: active
    , remote: remotePort
    , local: portOrPath
    , saved: !err
    , module: 'tcp'
    });
  });
};
controllers.ssh = function (req, res) {
  if (!req.body) {
    res.statusCode = 422;
    res.send({"error":{"message":"module 'ssh' needs more arguments"}});
    return;
  }

  function sshSuccess() {
    //state.config.sshAuto = state.sshAuto;
    saveConfig(function (err) {
      var local = state.config.sshAuto;
      if (false !== local && !local) {
        local = 22;
      }
      res.send({
        success: true
      , active: true
      , remote: Object.keys(state.config.ports)[0]
      , local: local
      , saved: !err
      , module: 'ssh'
      });
    });
  }

  var rawSshAuto = req.body.port || req.body[0];
  var sshAuto = rawSshAuto;
  if (-1 !== [ -1, 'false', 'none', 'off', 'disable' ].indexOf(sshAuto)) {
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
    res.send({ error: { message: "bad ssh_auto option '" + rawSshAuto + "'" } });
    return;
  }
  state.config.sshAuto = sshAuto;
  sshSuccess();
};
controllers.relay = function (req, res) {
  if (!req.body) {
    res.statusCode = 422;
    res.send({"error":{"message":"module \'relay\' needs more arguments"}});
    return;
  }

  return urequestAsync(req.body).then(function (resp) {
    resp = resp.toJSON();
    res.send(resp);
  });
};
controllers._nonces = {};
controllers._requireNonce = function (req, res, next) {
  var nonce = req.jws && req.jws.header && req.jws.header.nonce;
  var active = (Date.now() - controllers._nonces[nonce]) < (4 * 60 * 60 * 1000);
  if (!active) {
    // TODO proper headers and error message
    res.send({ "error": "invalid or expired nonce", "error_code": "ENONCE" });
    return;
  }
  delete controllers._nonces[nonce];
  controllers._issueNonce(req, res);
  next();
};
controllers._issueNonce = function (req, res) {
  var nonce = toUrlSafe(crypto.randomBytes(16).toString('base64'));
  // TODO associate with a TLS session
  controllers._nonces[nonce] = Date.now();
  res.setHeader("Replay-Nonce", nonce);
  return nonce;
};
controllers.newNonce = function (req, res) {
  res.statusCode = 200;
  res.setHeader("Cache-Control", "max-age=0, no-cache, no-store");
  // TODO
  //res.setHeader("Date", "Sun, 10 Mar 2019 08:04:45 GMT");
  // is this the expiration of the nonce itself? methinks maybe so
  //res.setHeader("Expires", "Sun, 10 Mar 2019 08:04:45 GMT");
  // TODO use one of the registered domains
  //var indexUrl = "https://acme-staging-v02.api.letsencrypt.org/index"
  var port = (state.config.ipc && state.config.ipc.port || state._ipc.port || undefined);
  var indexUrl = "http://localhost:" + port + "/index";
  res.setHeader("Link", "<" + indexUrl + ">;rel=\"index\"");
  res.setHeader("Cache-Control", "max-age=0, no-cache, no-store");
  res.setHeader("Pragma", "no-cache");
  //res.setHeader("Strict-Transport-Security", "max-age=604800");
  res.setHeader("X-Frame-Options", "DENY");

  controllers._issueNonce(req, res);
  res.end("");
};
controllers.newAccount = function (req, res) {
  controllers._requireNonce(req, res, function () {
    // TODO clean up error messages to be similar to ACME

    // check if there's a public key
    if (!req.jws || !req.jws.header.jwk) {
      res.statusCode = 422;
      res.send({ error: { message: "jws body was not present or could not be validated" } });
      return;
    }

    // TODO mx record email validation
    if (!Array.isArray(req.body.contact) || !req.body.contact.length && '127.0.0.1' !== req.connection.remoteAddress) {
      // req.body.contact: [ 'mailto:email' ]
      res.statusCode = 422;
      res.send({ error: { message: "jws signed payload should contain a valid mailto:email in the contact array" } });
      return;
    }
    if (!req.body.termsOfServiceAgreed) {
      // req.body.termsOfServiceAgreed: true
      res.statusCode = 422;
      res.send({ error: { message: "jws signed payload should have termsOfServiceAgreed: true" } });
      return;
    }

    // We verify here regardless of whether or not it was verified before,
    // because it needs to be signed by the presenter of the public key,
    // not just a trusted key
    return verifyJws(req.jws.header.jwk, req.jws).then(function (verified) {
      if (!verified) {
        res.statusCode = 422;
        res.send({ error: { message: "jws body failed verification" } });
        return;
      }

      var jwk = req.jws.header.jwk;
      return keypairs.thumbprint({ jwk: jwk }).then(function (thumb) {
        // Note: we can get any number of account requests
        // and these need to be stored for some space of time
        // to await verification.
        // we'll have to expire them somehow and prevent DoS

        // check if this account already exists
        var account;
        DB.accounts.some(function (acc) {
          // TODO calculate thumbprint from jwk
          // find a key with matching jwk
          if (acc.thumb === thumb) {
            account = acc;
            return true;
          }
          // TODO ACME requires kid to be the account URL (STUPID!!!)
          // rather than the key id (as decided by the key issuer)
          // not sure if it's necessary to handle it that way though
        });

        var myBaseUrl = (req.connection.encrypted ? 'https' : 'http') + '://' + req.headers.host;
        if (!account) {
          // fail if onlyReturnExisting is not false
          if (req.body.onlyReturnExisting) {
            res.statusCode = 422;
            res.send({ error: { message: "onlyReturnExisting is set, so there's nothing to do" } });
            return;
          }
          res.statusCode = 201;
          account = {};
          account._id = toUrlSafe(crypto.randomBytes(16).toString('base64'));
          // TODO be better about this
          account.location = myBaseUrl + '/acme/accounts/' + account._id;
          account.thumb = thumb;
          account.pub = jwk;
          account.contact = req.body.contact;
          account.useragent = req.headers["user-agent"];
          DB.accounts.push(account);
          state.config.accounts = DB.accounts;
          saveConfig(function () {});
        }

        var result = {
          status: 'valid'
        , contact: account.contact // [ "mailto:john.doe@gmail.com" ],
        , orders: account.location + '/orders'
          // optional / off-spec
        , id: account._id
        , jwk: account.pub
        /*
          // I'm not sure if we have the real IP through telebit's network wrapper at this point
          // TODO we also need to set X-Forwarded-Addr as a proxy
          "initialIp": req.connection.remoteAddress, //"128.187.116.28",
          "createdAt": (new Date()).toISOString(), // "2018-04-17T21:29:10.833305103Z",
        */
        };
        res.setHeader('Location', account.location);
        res.send(result);
        /*
          Cache-Control: max-age=0, no-cache, no-store
          Content-Type: application/json
          Expires: Tue, 17 Apr 2018 21:29:10 GMT
          Link: <https://letsencrypt.org/documents/LE-SA-v1.2-November-15-2017.pdf>;rel="terms-of-service"
          Location: https://acme-staging-v02.api.letsencrypt.org/acme/acct/5937234
          Pragma: no-cache
          Replay-nonce: DKxX61imF38y_qkKvVcnWyo9oxQlHll0t9dMwGbkcxw
         */
      });
    });
  });
};

function jsonEggspress(req, res, next) {
  /*
  var opts = url.parse(req.url, true);
  if (false && opts.query._body) {
    try {
      req.body = JSON.parse(decodeURIComponent(opts.query._body, true));
    } catch(e) {
      res.statusCode = 500;
      res.end('{"error":{"message":"?_body={{bad_format}}"}}');
      return;
    }
  }
  */

  var hasLength = req.headers['content-length'] > 0;
  if (!hasLength && !req.headers['content-type']) {
    next();
    return;
  }

  var body = '';
  req.on('readable', function () {
    var data;
    while (true) {
      data = req.read();
      if (!data) { break; }
      body += data.toString();
    }
  });
  req.on('end', function () {
    try {
      req.body = JSON.parse(body);
    } catch(e) {
      res.statusCode = 400;
      res.send({"error":{"message":"POST body is not valid json"}});
      return;
    }
    next();
  });
}

function decodeJwt(jwt) {
  var parts = jwt.split('.');
  var jws = {
    protected: parts[0]
  , payload: parts[0]
  , signature: parts[2] //Buffer.from(parts[2], 'base64')
  };
  jws.header = JSON.parse(Buffer.from(jws.protected, 'base64'));
  jws.claims = JSON.parse(Buffer.from(jws.payload, 'base64'));
  return jws;
}
function jwtEggspress(req, res, next) {
  var jwt = (req.headers.authorization||'').replace(/Bearer /i, '');
  if (!jwt) { next(); return; }

  try {
    req.jwt = decodeJwt(jwt);
  } catch(e) {
    // ignore
  }

  // TODO verify if possible
  console.warn("[warn] JWT is not verified yet");
  // A failed JWS should cause a failed JWT
  if (false !== req.trusted) {
    req.trusted = true;
  }
  next();
}

// TODO switch to Keypairs.js / Keyfetch.js
function verifyJws(jwk, jws) {
  return keypairs.export({ jwk: jwk }).then(function (pem) {
    var alg = 'SHA' + jws.header.alg.replace(/[^\d]+/i, '');
    var sig = ecdsaAsn1SigToJwtSig(jws.header.alg, jws.signature);
    return crypto
      .createVerify(alg)
      .update(jws.protected + '.' + jws.payload)
      .verify(pem, sig, 'base64');
  });
}

function jwsEggspress(req, res, next) {
  // Check to see if this looks like a JWS
  // TODO check header application/jose+json ??
  if (!req.body || !(req.body.protected && req.body.payload && req.body.signature)) {
    next();
    return;
  }

  // Decode it a bit
  req.jws = req.body;
  req.jws.header = JSON.parse(Buffer.from(req.jws.protected, 'base64'));
  req.body = Buffer.from(req.jws.payload, 'base64');
  if ('{'.charCodeAt(0) === req.body[0] || '['.charCodeAt(0) === req.body[0]) {
    req.body = JSON.parse(req.body);
  }

  var ua = req.headers['user-agent'];
  var trusted = false;
  var vjwk;
  var pubs;
  var kid = req.jws.header.kid;
  var p = Promise.resolve();
  if (!kid && !req.jws.header.jwk) {
    res.send({ error: { message: "jws protected header must include either 'kid' or 'jwk'" } });
    return;
  }
  if (req.jws.header.jwk) {
    if (kid) {
      res.send({ error: { message: "jws protected header must not include both 'kid' and 'jwk'" } });
      return;
    }
    kid = req.jws.header.jwk.kid;
    p = Keypairs.thumbprint({ jwk: req.jws.header.jwk }).then(function (thumb) {
      if (kid && kid !== thumb) {
        res.send({ error: { message: "jwk included 'kid' for key id, but it did not match the key's thumbprint" } });
        return;
      }
      kid = thumb;
      req.jws.header.jwk.kid = thumb;
    });
  }

  // Check if this is a key we already trust
  DB.pubs.some(function (jwk) {
    if (jwk.kid === kid) {
      trusted = true;
      vjwk = jwk;
      return true;
    }
  });

  // Check for CLI or Browser User-Agent
  // (both should connect as part of setup)
  if (/Telebit/i.test(ua) && !/Mozilla/i.test(ua)) {
    pubs = DB.pubs.filter(function (jwk) {
      if (/Telebit/i.test(jwk.useragent) && !/Mozilla/i.test(jwk.useragent)) {
        return true;
      }
    });
  } else {
    pubs = DB.pubs.filter(function (jwk) {
      if (!/Telebit/i.test(jwk.useragent) || /Mozilla/i.test(jwk.useragent)) {
        return true;
      }
    });
  }

  p.then(function () {
    // Check if there aren't any keys that we trust
    // and this has signed itself, then make it a key we trust
    // (TODO: move this all to the new account function)
    if (0 === pubs.length) { trusted = true; }
    if (!vjwk) { vjwk = req.jws.header.jwk; }
    // Don't verify if it can't be verified
    if (!vjwk) { return null; }

    // Run the  verification
    return p.then(function () {
      return verifyJws(vjwk, req.jws).then(function (verified) {
        if (true !== verified) { return null; }

        // Mark as verified
        req.jws.verified = verified;
        req.jws.trusted = trusted;
        vjwk.useragent = ua;

        // (double check) DO NOT save if there are existing pubs
        if (0 !== pubs.length) { return null; }

        DB.pubs.push(vjwk);
        return keystore.set(vjwk.kid + PUBEXT, vjwk);
      });
    });
  }).then(function () {
    // a failed JWT should cause a failed JWS
    if (false !== req.trusted) {
      req.trusted = req.jws.trusted;
    }
    next();
  });
}

function handleApi() {
  var app = eggspress();

  app.use('/', jwtEggspress);
  app.use('/', jsonEggspress);
  app.use('/', jwsEggspress);
  app.use('/', function (req, res, next) {
    if (req.jwt) {
      console.log('jwt', req.jwt);
    } else if (req.jws) {
      console.log('jws', req.jws);
      console.log('body', req.body);
    }
    next();
  });

  function listSuccess(req, res) {
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

    res.send(dumpy);
  }

  function getConfigOnly(req, res) {
    var resp = JSON.parse(JSON.stringify(state.config));
    resp.version = pkg.version;
    resp._otp = state.otp;
    res.send(resp);
  }

  //
  // without proper config
  //
  function saveAndReport(req, res) {
    console.log('[DEBUG] saveAndReport config write', confpath);
    console.log(YAML.safeDump(snakeCopy(state.config)));
    fs.writeFile(confpath, YAML.safeDump(snakeCopy(state.config)), function (err) {
      if (err) {
        res.statusCode = 500;
        res.send({"error":{"message":"Could not save config file after init: " + err.message.replace(/"/g, "'")
          + ".\nPerhaps check that the file exists and your user has permissions to write it?"}});
        return;
      }

      listSuccess();
    });
  }

  function initOrConfig(req, res) {
    var conf = {};
    if (!req.body) {
      res.statusCode = 422;
      res.send({"error":{"message":"module 'init' needs more arguments"}});
      return;
    }

    if (Array.isArray(req.body)) {
      // relay, email, agree_tos, servernames, ports
      //
      req.body.forEach(function (opt) {
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
    } else {
      conf = req.body;
    }

    conf = camelCopy(conf);

    // TODO deep merge
    // greenlock config
    if (!state.config.greenlock) { state.config.greenlock = {}; }
    if (conf.greenlock) {
      if ('undefined' !== typeof conf.greenlock.agree) {
        state.config.greenlock.agree = conf.greenlock.agree;
      }
      if (conf.greenlock.server) { state.config.greenlock.server = conf.greenlock.server; }
      if (conf.greenlock.version) { state.config.greenlock.version = conf.greenlock.version; }
    }

    // main config
    if (conf.email) { state.config.email = conf.email; }
    if (conf.relay) { state.config.relay = conf.relay; }
    if (conf.token) { state.config.token = conf.token; }
    if (conf.secret) { state.config.secret = conf.secret; }
    if ('undefined' !== typeof conf.agreeTos) {
      state.config.agreeTos = conf.agreeTos;
    }

    // to state
    if (conf.pretoken) { state.pretoken = conf.pretoken; }
    if (conf._otp) {
      state.otp = conf._otp; // TODO should this only be done on the client side?
      delete conf._otp;
    }

    console.log();
    console.log('conf.token', typeof conf.token, conf.token);
    console.log('state.config.token', typeof state.config.token, state.config.token);

    if (state.secret) { console.log('state.secret'); state.token = common.signToken(state); }
    if (!state.token) { console.log('!state.token'); state.token = conf._token; }

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
      console.warn('missing config');
      res.statusCode = 400;

      res.send({
        error: {
          code: "E_INIT"
        , message: "Missing important config file params"
        , _params: JSON.stringify(conf)
        , _config: JSON.stringify(state.config)
        , _body: JSON.stringify(req.body)
        }
      });
      return;
    }

    // init also means enable
    delete state.config.disable;
    safeStartTelebitRemote(true).then(saveAndReport).catch(handleError);
  }

  function restart(req, res) {
    console.info("[telebitd.js] server closing...");
    state.keepAlive.state = false;
    if (myRemote) {
      myRemote.end();
      myRemote.on('end', respondAndClose);
      // failsafe
      setTimeout(function () {
        console.info("[telebitd.js] closing too slowly, force quit");
        respondAndClose();
      }, 5 * 1000);
    } else {
      respondAndClose();
    }

    function respondAndClose() {
      res.send({ success: true });
      controlServer.close(function () {
        console.info("[telebitd.js] server closed");
        setTimeout(function () {
          // system daemon will restart the process
          process.exit(22); // use non-success exit code
        }, 100);
      });
    }
  }

  function mustHaveValidConfig(req, res, next) {
    //
    // Check for proper config
    //
    if (state.config.relay && state.config.email && state.config.agreeTos) {
      next();
      return;
    }

    res.statusCode = 400;
    res.send({
      error: { code: "E_CONFIG", message: "Invalid config file. Please run 'telebit init'" }
    });
  }

  function saveAndCommit(req, res) {
    state.config.servernames = state.servernames;
    state.config.ports = state.ports;
    fs.writeFile(confpath, YAML.safeDump(snakeCopy(state.config)), function (err) {
      if (err) {
        res.statusCode = 500;
        res.send({
          "error":{"message":"Could not save config file. Perhaps you're not running as root?"}
        });
        return;
      }
      listSuccess();
    });
  }

  function handleError(err, req, res) {
    res.statusCode = 500;
    res.send({
      error: { message: err.message, code: err.code }
    });
  }

  function enable(req, res) {
    delete state.config.disable;// = undefined;
    state.keepAlive.state = true;

    fs.writeFile(confpath, YAML.safeDump(snakeCopy(state.config)), function (err) {
      if (err) {
        err.message = "Could not save config file. Perhaps you're user doesn't have permission?";
        handleError(err, req, res);
        return;
      }
      // TODO XXX myRemote.active
      if (myRemote) {
        listSuccess(req, res);
        return;
      }
      safeStartTelebitRemote(true).then(listSuccess).catch(function () {
        handleError(err, req, res);
      });
    });
  }

  function disable(req, res) {
    state.config.disable = true;
    state.keepAlive.state = false;

    if (myRemote) { myRemote.end(); myRemote = null; }
    fs.writeFile(confpath, YAML.safeDump(snakeCopy(state.config)), function (err) {
      if (err) {
        err.message = "Could not save config file. Perhaps you're user doesn't have permission?";
        handleError(err);
        return;
      }
      res.send({"success":true});
    });
  }

  function getStatus(req, res) {
    var now = Date.now();
    require('../lib/ssh.js').checkSecurity().then(function (ssh) {
      res.send(
        { module: 'status'
        , version: pkg.version
        , port: (state.config.ipc && state.config.ipc.port || state._ipc.port || undefined)
        , enabled: !state.config.disable
        , active: !!myRemote
        , initialized: (state.config.relay && state.config.token && state.config.agreeTos) ? true : false
        , connected: isConnected
        //, proctime: Math.round(process.uptime() * 1000)
        , uptime: now - startTime
        , runtime: isConnected && connectTimes.length && (now - connectTimes[0]) || 0
        , reconnects: connectTimes.length
        , servernames: state.servernames
        , ssh: state.config.sshAuto
        , ssh_permit_root_login: ssh.permit_root_login
        , ssh_password_authentication: ssh.password_authentication
        , ssh_requests_password: ssh.requests_password
        }
      );
    });
  }

  // TODO turn strings into regexes to match beginnings
  app.get('/.well-known/openid-configuration', function (req, res) {
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Link, Replay-Nonce, Location");
    res.setHeader("Access-Control-Max-Age", "86400");
    if ('OPTIONS' === req.method) { res.end(); return; }
    res.send({
      jwks_uri: 'http://localhost/.well-known/jwks.json'
    , acme_uri: 'http://localhost/acme/directory'
    });
  });
  app.use('/acme', function acmeCors(req, res, next) {
    // Taken from New-Nonce
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Link, Replay-Nonce, Location");
    res.setHeader("Access-Control-Max-Age", "86400");
    if ('OPTIONS' === req.method) { res.end(); return; }
    next();
  });
  app.get('/acme/directory', function (req, res) {
    var myBaseUrl = (req.connection.encrypted ? 'https' : 'http') + '://' + req.headers.host;
    res.send({
      'newNonce': '/acme/new-nonce'
    , 'newAccount': '/acme/new-acct'
      // TODO link to the terms that the user selects
    , 'meta': { 'termsOfService': myBaseUrl + '/acme/terms.html' }
    });
  });
  app.head('/acme/new-nonce', controllers.newNonce);
  app.get('/acme/new-nonce', controllers.newNonce);
  app.post('/acme/new-acct', controllers.newAccount);
  function mustTrust(req, res, next) {
    // TODO public routes should be explicitly marked
    // trusted should be the default
    if (req.trusted) { next(); }
    res.statusCode = 400;
    res.send({"error":{"message": "this type of requests must be encoded as a jws payload"
      + " and signed by a trusted account holder"}});
    return;
  }
  app.use(/\b(relay)\b/, mustTrust, controllers.relay);
  app.get(/\b(config)\b/, mustTrust, getConfigOnly);
  app.use(/\b(init|config)\b/, mustTrust, initOrConfig);
  app.use(/\b(restart)\b/, mustTrust, restart);

  // Position is important with eggspress
  // This should stay here, right before the other methods
  app.use('/', mustHaveValidConfig);

  //
  // With proper config
  //
  app.use(/\b(http)\b/, mustTrust, controllers.http);
  app.use(/\b(tcp)\b/, mustTrust, controllers.tcp);
  app.use(/\b(save|commit)\b/, mustTrust, saveAndCommit);
  app.use(/\b(ssh)\b/, mustTrust, controllers.ssh);
  app.use(/\b(enable)\b/, mustTrust, enable);
  app.use(/\b(disable)\b/, mustTrust, disable);
  app.use(/\b(status)\b/, mustTrust, getStatus);
  app.use(/\b(list)\b/, mustTrust, listSuccess);
  app.use('/', function (req, res) {
    res.send({"error":{"message":"unrecognized rpc"}});
  });

  return app;
}

function serveControlsHelper() {
  var app = eggspress();
  var serveStatic = require('serve-static')(path.join(__dirname, '../lib/admin/'));
  var apiHandler = handleApi();

  app.use('/rpc/', apiHandler);
  app.use('/api/', apiHandler);
  app.use('/acme/', apiHandler);
  app.use('/', serveStatic);

  controlServer = http.createServer(app);

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
  if (!state.config.ipc) {
    state.config.ipc = {};
  }
  if (!state.config.ipc.path) {
    state.config.ipc.path = path.dirname(state._ipc.path);
  }
  require('mkdirp').sync(state.config.ipc.path);
  if (!state.config.ipc.type) {
    state.config.ipc.type = 'port';
  }
  var portFile = path.join(state.config.ipc.path, 'telebit.port');
  if (fs.existsSync(portFile)) {
    state._ipc.port = parseInt(fs.readFileSync(portFile, 'utf8').trim(), 10);
  }

  if ('socket' === state._ipc.type) {
    require('mkdirp').sync(path.dirname(state._ipc.path));
  }
  // https://nodejs.org/api/net.html#net_server_listen_options_callback
  // path is ignore if port is defined
  // https://git.coolaj86.com/coolaj86/telebit.js/issues/23#issuecomment-326
  if ('port' === state.config.ipc.type) {
    serverOpts.host = 'localhost';
    serverOpts.port = state._ipc.port || 0;
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
  controlServer.on('error', function (err) {
    if ('EADDRINUSE' === err.code) {
      try {
        fs.unlinkSync(portFile);
      } catch(e) {
        // nada
      }
      setTimeout(function () {
        console.log("Could not start control server (%s), trying again...", err.code);
        console.log(portFile);
        console.log(serverOpts);
        serveControlsHelper();
      }, 1000);
      return;
    }
    console.error('failed to start c&c server:', err);
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
  return safeStartTelebitRemote().catch(function (err) {
    // ignore, it'll keep looping anyway
    console.warn("[debug] error that (supposedly) shouldn't matter:");
    console.warn(err);
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
  DB.accounts = state.config.accounts || [];

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
  , _communityPackage: 'telebit.js'
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
function safeStartTelebitRemote(forceOn) {
  // whatever is currently going will not restart
  state.keepAlive.state = false;
  if (trPromise && !forceOn) { return trPromise; }

  // if something is running, this will kill it
  // (TODO option to use known-good active instead of restarting)
  // this won't restart either
  trPromise = rawStartTelebitRemote(state.keepAlive);
  trPromise.then(function () {
    console.log("[debug] success on raw start, keepAlive = true");
    state.keepAlive.state = true;
    trPromise = null;
  }).catch(function () {
    console.log("[debug] failure on raw start, { keepAlive = true }");
    // this will restart
    state.keepAlive = { state: true };
    trPromise = rawStartTelebitRemote(state.keepAlive);
    trPromise.then(function () {
      console.log("[debug] success on 2nd start keepAlive:", state.keepAlive.state);
      trPromise = null;
    }).catch(function () {
      console.log("[debug] failure on 2nd start. keepAlive", state.keepAlive.state);
      trPromise = null;
    });
  });
  return trPromise;
}

function rawStartTelebitRemote(keepAlive) {
  var err;
  var exiting = false;
  var localRemote = myRemote;
  myRemote = null;
  if (localRemote) { /*console.log('DEBUG destroy() existing');*/ localRemote.destroy(); }

  function safeReload(delay) {
    if (exiting) {
      // return a junk promise as the prior call
      // already passed flow-control to the next promise
      // (this is a second or delayed error or close event)
      return PromiseA.resolve();
    }
    exiting = true;
    // TODO state.keepAlive?
    return promiseTimeout(delay).then(function () {
      return rawStartTelebitRemote(keepAlive);
    });
  }

  if (state.config.disable) {
    //console.log('DEBUG disabled or incapable');
    err = new Error("connecting is disabled");
    err.code = 'EDISABLED';
    return PromiseA.reject(err);
  }

  if (!(state.config.token || state.config.agreeTos)) {
    //console.log('DEBUG Must agreeTos to generate preauth');
    err = new Error("Must either supply token (for auth) or agreeTos (for preauth)");
    err.code = 'ENOAGREE';
    return PromiseA.reject(err);
  }

  state.relay = state.config.relay;
  if (!state.relay) {
    //console.log('DEBUG no relay');
    err = new Error("'" + state._confpath + "' is missing 'relay'");
    err.code = 'ENORELAY';
    return PromiseA.reject(err);
  }

  // TODO: we need some form of pre-authorization before connecting,
  // otherwise we'll get disconnected pretty quickly
  if (!(state.token || state.pretoken)) {
    //console.log('DEBUG no token');
    err = new Error("no jwt token or preauthorization");
    err.code = 'ENOAUTH';
    return PromiseA.reject(err);
  }

  return PromiseA.resolve().then(function () {
    //console.log('DEBUG rawStartTelebitRemote');

    function startHelper() {
      //console.log('DEBUG startHelper');
      greenlockHelper(state);
      // Saves the token
      // state.handlers.access_token({ jwt: token });
      // Adds the token to the connection
      // tun.append(token);

      //console.log("[DEBUG] token", typeof token, token);
      //state.sortingHat = state.config.sortingHat;
      // { relay, config, servernames, ports, sortingHat, net, insecure, token, handlers, greenlockConfig }

      return new PromiseA(function (myResolve, myReject) {
        function reject(err) {
          if (myReject) {
            myReject(err);
            myResolve = null;
            myReject = null;
          } else {
            //console.log('DEBUG double rejection');
          }
        }
        function resolve(val) {
          //console.log('[DEBUG] pre-resolve');
          if (myResolve) {
            myResolve(val);
            myResolve = null;
            myReject = null;
          } else {
            //console.log('DEBUG double resolution');
          }
        }

        function onConnect() {
          isConnected = true;
          connectTimes.unshift(Date.now());
          console.info('[connect] relay established');
          myRemote.removeListener('error', onConnectError);
          myRemote.once('error', function (err) {
            console.log("[debug] Error after connect.");
            console.log(err);
            if (!keepAlive.state) {
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
          isConnected = false;
          if (handleError(err, 'onConnectError')) {
            if (!keepAlive.state) {
              reject(err);
              return;
            }
            safeReload(10 * 1000).then(resolve).catch(reject);
            return;
          }
          console.error('[Error] onConnectError: no retry (possibly bad auth):');
          console.error(err);
          reject(err);
          return;
        }

        function retryLoop() {
          isConnected = false;
          console.warn('[Warn] disconnected. Will retry?', keepAlive.state);
          if (keepAlive.state) {
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

    function handleError(err, prefix) {
      // Likely causes:
      //   * DNS lookup failed (no Internet)
      //   * Rejected (bad authn)
      if ('ENOTFOUND' === err.code) {
        // DNS issue, probably network is disconnected
        err.message = [
          '[warn] (' + prefix + '): DNS address not found.'
        , '    Either the remote does not exist or local network is down or blocked.'
        , '    You might check wifi, eth, paywall, etc.'
        ].join('\n');
        if (keepAlive.error !== err.code) {
          console.warn(err.message);
          keepAlive.error = err.code;
          console.warn("(retrying silently)");
        }
        return true;
      } else if ('ECONNREFUSED' === err.code) {
        // Server issue. If it's the development server, it's probably down
        err.message = [
          '[warn] onConnectError: Connection Refused.'
        , '    Either the remote does not exist or local network is blocking it.'
        , '    Is the relay service provider\'s website up? Did you make a typo?'
        , '    Is there a local firewall or paywall? Might the relay be otherwise blocked?'
        ].join('\n');
        if (keepAlive.error !== err.code) {
          console.warn(err.message);
          keepAlive.error = err.code;
          console.warn("(retrying silently)");
        }
        return true;
      }
    }

    // get the wss url
    function retryWssLoop(err) {
      if (!keepAlive.state) {
        console.log("[debug] error getting wss url:");
        console.log(err);
        return PromiseA.reject(err);
      }

      myRemote = null;
      if (handleError(err, 'retryWssLoop')) {
        // Always retry at this stage. It *is* a connectivity problem.
        // Since the internet is disconnected, try again and again and again.
        return safeReload(2 * 1000);
      } else {
        console.error("[error] retryWssLoop (will not retry):");
        console.error(err.message);
        return PromiseA.reject(err);
      }
    }

    // It makes since for this to be in here because the server
    // could be restarting to force a change of the metadata
    return promiseWss(state).then(function (wss) {
      state.wss = wss;
      console.log("[debug] got wss url");
      keepAlive.error = null;
      return startHelper();
    }).catch(retryWssLoop);
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
    // TODO don't put token in config
    state.config.token = opts.jwt || opts.access_token;
    console.info("Placing new token in keystore.");
    try {
      fs.writeFileSync(confpath, YAML.safeDump(snakeCopy(state.config)));
    } catch (e) {
      console.error("Token not saved:");
      console.error(e);
    }
    return keystore.set("access_token.jwt", opts.jwt || opts.access_token).catch(function (e) {
      console.error("Token not saved:");
      console.error(e);
    });
  }
};

function sigHandler() {
  process.removeListener('SIGINT', sigHandler);

  console.info('Received kill signal. Attempting to exit cleanly...');
  state.keepAlive.state = false;

  // We want to handle cleanup properly unless something is broken in our cleanup process
  // that prevents us from exitting, in which case we want the user to be able to send
  // the signal again and exit the way it normally would.
  if (myRemote) {
    myRemote.end();
    myRemote = null;
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

var DB = {};
DB.pubs = [];
DB.accounts = [];
var token;
var tokenname = "access_token.jwt";
try {
  // backwards-compatibility shim
  var tokenpath = path.join(path.dirname(state._confpath), 'access_token.txt');
  token = fs.readFileSync(tokenpath, 'ascii').trim();
  keystore.set(tokenname, token).then(onKeystore).catch(function (err) {
    console.error('keystore failure:');
    console.error(err);
  });
} catch(e) { onKeystore(); }
function onKeystore() {
  return keystore.all().then(function (list) {
    var key;
    list.forEach(function (el) {
      // find key
      if (KEYEXT === el.account.slice(-KEYEXT.length)
        && el.password.kty && el.password.kid) {
        key = el.password;
        return;
      }

      // find token
      if (tokenname === el.account) {
        token = el.password;
        return;
      }

      // find trusted public keys
      // (if we sign these we could probably just store them to the fs,
      // but we do want some way to know that they weren't just willy-nilly
      // added to the fs my any old program)
      if (PUBEXT === el.account.slice(-PUBEXT.length)) {
        // pre-parsed
        DB.pubs.push(el.password);
        return;
      }

      console.log("unrecognized password: %s", el.account);
    });

    if (key) {
      state.key = key;
      state.pub = keypairs.neuter({ jwk: key });
      fs.readFile(confpath, 'utf8', parseConfig);
      return;
    }

    return keypairs.generate().then(function (pair) {
      var jwk = pair.private;
      return keypairs.thumbprint({ jwk: jwk }).then(function (kid) {
        jwk.kid = kid;
        return keystore.set(kid + KEYEXT, jwk).then(function () {
          var size = (jwk.crv || Buffer.from(jwk.n, 'base64').byteLength * 8);
          console.info("Generated new %s %s private key with thumbprint %s", jwk.kty, size, kid);
          state.key = jwk;
          fs.readFile(confpath, 'utf8', parseConfig);
        });
      });
    });
  });
}
}());

function ecdsaAsn1SigToJwtSig(alg, b64sig) {
  // ECDSA JWT signatures differ from "normal" ECDSA signatures
  // https://tools.ietf.org/html/rfc7518#section-3.4
  if (!/^ES/i.test(alg)) { return b64sig; }

  var bufsig = Buffer.from(b64sig, 'base64');
  var hlen = bufsig.byteLength / 2; // should be even
  var r = bufsig.slice(0, hlen);
  var s = bufsig.slice(hlen);
  // unpad positive ints less than 32 bytes wide
  while (!r[0]) { r = r.slice(1); }
  while (!s[0]) { s = s.slice(1); }
  // pad (or re-pad) ambiguously non-negative BigInts to 33 bytes wide
  if (0x80 & r[0]) { r = Buffer.concat([Buffer.from([0]), r]); }
  if (0x80 & s[0]) { s = Buffer.concat([Buffer.from([0]), s]); }

  var len = 2 + r.byteLength + 2 + s.byteLength;
  var head = [0x30];
  // hard code 0x80 + 1 because it won't be longer than
  // two SHA512 plus two pad bytes (130 bytes <= 256)
  if (len >= 0x80) { head.push(0x81); }
  head.push(len);

  var buf = Buffer.concat([
    Buffer.from(head)
  , Buffer.from([0x02, r.byteLength]), r
  , Buffer.from([0x02, s.byteLength]), s
  ]);

  return toUrlSafe(buf.toString('base64'));
}

function toUrlSafe(b64) {
  return b64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
  ;
}

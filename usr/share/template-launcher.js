'use strict';

var path = require('path');
var fs = require('fs');
var os = require('os');

module.exports = function (opts, fn) {
  // TODO make async version
  try {
    module.exports.sync(opts);
  } catch(e) {
    if (fn) { fn(e); }
  }

  if (fn) { fn(null); }
};
module.exports.sync = function (opts) {
  var f = opts.file;
  var vars = opts.vars;
  var text = fs.readFileSync(f.tpl, 'utf8')
    .replace(/{TELEBIT_PATH}/g, vars.telebitPath || '{TELEBIT_PATH}')
    .replace(/{TELEBIT_NODE}/g, vars.telebitNode || '{TELEBIT_NODE}')
    .replace(/{NODE_PATH}/g, vars.nodePath || '{NODE_PATH}')
    .replace(/{NPM_CONFIG_PREFIX}/g, vars.npmConfigPrefix || '{NPM_CONFIG_PREFIX}')
    .replace(/{TELEBIT_NPM}/g, vars.telebitNpm || '{TELEBIT_NPM}')
    .replace(/{TELEBIT_BIN}/g, vars.telebitBin || '{TELEBIT_BIN}')
    .replace(/{TELEBITD_BIN}/g, vars.telebitdBin || '{TELEBITD_BIN}')
    .replace(/{TELEBIT_JS}/g, vars.telebitJs || '{TELEBIT_JS}')
    .replace(/{TELEBITD_JS}/g, vars.telebitdJs || '{TELEBITD_JS}')
    .replace(/{TELEBIT_USER}/g, vars.telebitUser || '{TELEBIT_USER}')
    .replace(/{TELEBIT_GROUP}/g, vars.telebitGroup || '{TELEBIT_GROUP}')
    .replace(/{TELEBIT_RW_DIRS}/g, vars.telebitRwDirs || '{TELEBIT_RW_DIRS}')
    .replace(/{TELEBIT_CONFIG}/g, vars.telebitConfig || '{TELEBIT_CONFIG}')
    .replace(/{TELEBITD_CONFIG}/g, vars.telebitdConfig || '{TELEBITD_CONFIG}')
    .replace(/{TELEBIT_LOG_DIR}/g, vars.TELEBIT_LOG_DIR || '{TELEBIT_LOG_DIR}')
    .replace(/{TELEBIT_SOCK_DIR}/g, vars.TELEBIT_LOG_DIR || '{TELEBIT_SOCK_DIR}')
    ;
  fs.writeFileSync(f.launcher, text, 'utf8');
  if (f.executable && !/^win/i.test(os.platform())) {
    // TODO not sure if chmod works on windows
    fs.chmodSync(f.launcher, parseInt('755', 8));
  }
};

function run() {
  var files = [
    { tpl: (process.env.TELEBIT_SERVICE_TPL || path.join(__dirname, 'dist/etc/systemd/system/telebit.service.tpl'))
    , launcher: (process.env.TELEBIT_SERVICE || path.join(__dirname, 'dist/etc/systemd/system/telebit.service'))
    }
  , { tpl: (process.env.TELEBIT_USER_SERVICE_TPL || path.join(__dirname, 'dist/etc/skel/.config/systemd/user/telebit.service.tpl'))
    , launcher: (process.env.TELEBIT_USER_SERVICE || path.join(__dirname, 'dist/etc/skel/.config/systemd/user/telebit.service'))
    }
  , { tpl: (process.env.TELEBIT_PLIST_TPL || path.join(__dirname, 'dist/Library/LaunchDaemons/cloud.telebit.remote.plist.tpl'))
    , launcher: (process.env.TELEBIT_PLIST || path.join(__dirname, 'dist/Library/LaunchDaemons/cloud.telebit.remote.plist'))
    }
  , { tpl: (process.env.TELEBIT_USER_PLIST_TPL || path.join(__dirname, 'dist/etc/skel/Library/LaunchAgents/cloud.telebit.remote.plist.tpl'))
    , launcher: (process.env.TELEBIT_USER_PLIST || path.join(__dirname, 'dist/etc/skel/Library/LaunchAgents/cloud.telebit.remote.plist'))
    }
  ];

  files.forEach(function (f) {
    var telebitRoot = path.resolve(__dirname, '../..');
    var vars = {
      telebitPath: process.env.TELEBIT_PATH || telebitRoot
    , telebitNode: process.env.TELEBIT_NODE || process.argv[0] || path.resolve(telebitRoot, 'bin/node')
    , telebitBin: process.env.TELEBIT_BIN || path.resolve(telebitRoot, 'bin/telebit')
    , telebitdBin: process.env.TELEBITD_BIN || path.resolve(telebitRoot, 'bin/telebitd')
    , telebitJs: process.env.TELEBIT_JS || path.resolve(telebitRoot, 'bin/telebit.js')
    , telebitdJs: process.env.TELEBITD_JS || path.resolve(telebitRoot, 'bin/telebitd.js')
    , telebitRwDirs: [
        (process.env.TELEBIT_PATH || path.resolve(__dirname, '../..'))
      , path.join(os.homedir(), '.config/telebit')
      , path.join(os.homedir(), '.local/share/telebit')
      ]
    , telebitUser: process.env.TELEBIT_USER || os.userInfo().username
    , telebitGroup: process.env.TELEBIT_GROUP || ('darwin' === os.platform() ? 'staff' : os.userInfo().username)
    , telebitConfig: process.env.TELEBIT_CONFIG || path.join(os.homedir(), '.config/telebit/telebit.yml')
    , telebitdConfig: process.env.TELEBITD_CONFIG || path.join(os.homedir(), '.config/telebit/telebitd.yml')
    , TELEBIT_LOG_DIR: process.env.TELEBIT_LOG_DIR || path.join(os.homedir(), '.local/share/telebit/var/log')
    };
    vars.telebitNpm = process.env.TELEBIT_NPM || path.resolve(vars.telebitNode, '../npm');
    vars.nodePath = process.env.NODE_PATH || path.resolve(vars.telebitNode, '../lib/node_modules');
    vars.npmConfigPrefix = process.env.NPM_CONFIG_PREFIX || path.resolve(vars.telebitNode, '..');
    if (-1 === vars.telebitRwDirs.indexOf(vars.npmConfigPrefix)) {
      vars.telebitRwDirs.push(vars.npmConfigPrefix);
    }
    vars.telebitRwDirs = vars.telebitRwDirs.join(' ');
    module.exports({
      file: f
    , vars: vars
    });
  });
}

if (module === require.main) {
  run();
}

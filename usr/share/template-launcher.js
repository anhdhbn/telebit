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
    ;
  fs.writeFileSync(f.launcher, text, 'utf8');
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
    , telebitNode: process.env.TELEBIT_NODE || path.resolve(telebitRoot, 'bin/node')
    , telebitNpm: process.env.TELEBIT_NPM || path.resolve(telebitRoot, 'bin/npm')
    , telebitBin: process.env.TELEBIT_BIN || path.resolve(telebitRoot, 'bin/telebit')
    , telebitdBin: process.env.TELEBITD_BIN || path.resolve(telebitRoot, 'bin/telebitd')
    , telebitJs: process.env.TELEBIT_JS || path.resolve(telebitRoot, 'bin/telebit.js')
    , telebitdJs: process.env.TELEBITD_JS || path.resolve(telebitRoot, 'bin/telebitd.js')
    , telebitRwDirs: [
        (process.env.TELEBIT_PATH || path.resolve(__dirname, '../..'))
      , path.join(os.homedir(), '.config/telebit')
      , path.join(os.homedir(), '.local/share/telebit')
      ].join(' ')
    , telebitUser: process.env.TELEBIT_USER || os.userInfo().username
    , telebitGroup: process.env.TELEBIT_GROUP || ('darwin' === os.platform() ? 'staff' : os.userInfo().username)
    , telebitConfig: process.env.TELEBIT_CONFIG || path.join(os.homedir(), '.config/telebit/telebit.yml')
    , telebitdConfig: process.env.TELEBITD_CONFIG || path.join(os.homedir(), '.config/telebit/telebitd.yml')
    };
    module.exports({
      file: f
    , vars: vars
    });
  });
}

if (module === require.main) {
  run();
}

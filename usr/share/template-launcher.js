'use strict';

var path = require('path');
var fs = require('fs');
var os = require('os');

var files = [
  [ (process.env.TELEBIT_SERVICE_TPL || path.join(__dirname, 'dist/etc/systemd/system/telebit.service.tpl'))
  , (process.env.TELEBIT_SERVICE || path.join(__dirname, 'dist/etc/systemd/system/telebit.service'))
  ]
, [ (process.env.TELEBIT_PLIST_TPL || path.join(__dirname, 'dist/Library/LaunchDaemons/cloud.telebit.remote.plist.tpl'))
  ,(process.env.TELEBIT_PLIST || path.join(__dirname, 'dist/Library/LaunchDaemons/cloud.telebit.remote.plist'))
  ]
, [ (process.env.TELEBIT_USER_PLIST_TPL || path.join(__dirname, 'dist/etc/skel/Library/LaunchAgents/cloud.telebit.remote.plist.tpl'))
  ,(process.env.TELEBIT_USER_PLIST || path.join(__dirname, 'dist/etc/skel/Library/LaunchAgents/cloud.telebit.remote.plist'))
  ]
];
var vars = {
  telebitPath: process.env.TELEBIT_PATH || path.resolve(__dirname, '../..')
, telebitRwDirs: [
    (process.env.TELEBIT_PATH || path.resolve(__dirname, '../..'))
  , path.join(os.homedir(), '.config/telebit')
  , path.join(os.homedir(), '.local/share/telebit')
  , ].join(' ')
, telebitUser: process.env.TELEBIT_USER || os.userInfo().username
, telebitGroup: process.env.TELEBIT_GROUP || ('darwin' === os.platform() ? 'staff' : os.userInfo().username)
, telebitConfig: process.env.TELEBIT_CONFIG || path.join(os.homedir(), '.config/telebit/telebitd.yml')
};
files.forEach(function (f) {
  var text = fs.readFileSync(f[0], 'utf8')
    .replace(/{TELEBIT_PATH}/g, vars.telebitPath)
    .replace(/{TELEBIT_USER}/g, vars.telebitUser)
    .replace(/{TELEBIT_GROUP}/g, vars.telebitGroup)
    .replace(/{TELEBIT_RW_DIRS}/g, vars.telebitRwDirs)
    .replace(/{TELEBIT_CONFIG}/g, vars.telebitConfig)
    ;
  fs.writeFileSync(f[1], text, 'utf8');
});

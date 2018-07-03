'use strict';

var path = require('path');
var spawn = require('child_process').spawn;
var args = [
  path.join(__dirname, 'windows-pipe.js')
];
var subprocess = spawn(
  'node'
, args
, { detached: true
  , stdio: [ 'ignore', process.stdout, process.stderr ]
  }
);
//console.log('[debug]', vars.telebitNode, args.join(' '));
subprocess.unref();
subprocess.on('error', function (_err) {
  console.error(_err);
});
subprocess.on('exit', function (code, signal) {
  console.error('' + code + ' ' + signal + ' failure to launch');
});

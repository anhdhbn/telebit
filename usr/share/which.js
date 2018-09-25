'use strict';

var os = require('os');
var exec = require('child_process').exec;

var which = module.exports;

which._getError = function getError(err, stderr) {
  if (err) { return err; }
  if (stderr) {
    err = new Error(stderr);
    err.code = 'EWHICH';
    return err;
  }
};

module.exports.which = function (cmd, execOpts, fn) {
  return module.exports._which({
    mac: cmd
  , linux: cmd
  , win: cmd
  }, execOpts, fn);
};
module.exports.launcher = function (execOpts, fn) {
  return module.exports._which({
    mac: 'launchctl'
  , linux: 'systemctl'
  , win: 'reg.exe'
  }, execOpts, fn);
};
module.exports._which = function (progs, execOpts, fn) {
  // could have used "command-exists" but I'm trying to stay low-dependency
  // os.platform(), os.type()
  if (!/^win/i.test(os.platform())) {
    if (/^darwin/i.test(os.platform())) {
      exec('command -v ' + progs.mac, execOpts, function (err, stdout, stderr) {
        err = which._getError(err, stderr);
        fn(err, progs.mac);
      });
    } else {
      exec('command -v ' + progs.linux, execOpts, function (err, stdout, stderr) {
        err = which._getError(err, stderr);
        fn(err, progs.linux);
      });
    }
  } else {
    // https://stackoverflow.com/questions/17908789/how-to-add-an-item-to-registry-to-run-at-startup-without-uac
    // wininit? regedit? SCM?
    // REG ADD "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" /V "My App" /t REG_SZ /F /D "C:\MyAppPath\MyApp.exe"
    // https://www.microsoft.com/developerblog/2015/11/09/reading-and-writing-to-the-windows-registry-in-process-from-node-js/
    // https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/reg-add
    // https://social.msdn.microsoft.com/Forums/en-US/5b318f44-281e-4098-8dee-3ba8435fa391/add-registry-key-for-autostart-of-app-in-ice?forum=quebectools
    // utils.elevate
    // https://github.com/CatalystCode/windows-registry-node
    exec('where ' + progs.win, execOpts, function (err, stdout, stderr) {
      //console.log((stdout||'').trim());
      if (stderr) {
        console.error(stderr);
      }
      fn(err, progs.win);
    });
  }
};

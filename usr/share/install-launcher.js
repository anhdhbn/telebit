'use strict';

//var fs = require('fs');
var os = require('os');
var mkdirp = require('mkdirp');
var exec = require('child_process').exec;
var path = require('path');

var Launcher = module.exports;
Launcher.install = function (things, fn) {
  if (!fn) { fn = function (err) { if (err) { console.error(err); } }; }
  things = things || {};
  // in some future version we can take this file out
  // and accept process.env from things
  var installLauncher = require('./template-launcher');

  // Right now this is just for npm install -g and npx
  if (things.env) {
    things.env.PATH = things.env.PATH || process.env.PATH;
  } else {
    things.env = process.env;
  }
  things.argv = things.argv || process.argv;
  things._execOpts = { windowsHide: true, env: things.env };
  var telebitRoot = path.join(__dirname, '../..');
  var vars = {
    telebitPath: telebitRoot
  , telebitUser: os.userInfo().username
  , telebitGroup: (/^darwin/i.test(os.platform()) ? 'staff' : os.userInfo().username)
  , telebitRwDirs: [
      path.resolve(__dirname, '../..')
    , path.join(os.homedir(), '.config/telebit')
    , path.join(os.homedir(), '.local/share/telebit')
    ]
  , telebitNode: (things.argv[0]||'').replace(/\.exe/i, '') // path.join(telebitRoot, 'bin/node')
  , telebitBin: path.join(telebitRoot, 'bin/telebit')
  , telebitdBin: path.join(telebitRoot, 'bin/telebitd')
  , telebitJs: path.join(telebitRoot, 'bin/telebit.js')
  , telebitdJs: path.join(telebitRoot, 'bin/telebitd.js')
  , telebitConfig: path.join(os.homedir(), '.config/telebit/telebit.yml')
  , telebitdConfig: path.join(os.homedir(), '.config/telebit/telebitd.yml')
  , TELEBIT_LOG_DIR: path.join(os.homedir(), '.local/share/telebit/var/log')
  };
  vars.telebitBinTpl = path.join(telebitRoot, 'usr/share/dist/bin/telebit.tpl');
  vars.telebitNpm = path.resolve(vars.telebitNode, '../npm');
  vars.nodePath = path.resolve(vars.telebitNode, '../lib/node_modules');
  vars.npmConfigPrefix = path.resolve(vars.telebitNode, '..');
  vars.userspace = (!things.telebitUser || (things.telebitUser === os.userInfo().username)) ? true : false;
  if (-1 === vars.telebitRwDirs.indexOf(vars.npmConfigPrefix)) {
    vars.telebitRwDirs.push(vars.npmConfigPrefix);
  }
  vars.telebitRwDirs = vars.telebitRwDirs.join(' ');
  function getError(err, stderr) {
    if (err) { return err; }
    if (stderr) {
      err = new Error(stderr);
      err.code = 'ELAUNCHER';
      return err;
    }
  }
  var launchers = {
    'node': function () {
      var fs = require('fs');
      var spawn = require('child_process').spawn;
      var logpath = path.join(os.homedir(), '.local/share/telebit/var/log');
      try {
        mkdirp.sync(logpath);
      } catch(e) {
        if (fn) { fn(e); return; }
        return;
      }
      var stdout = fs.openSync(path.join(logpath, 'info.log'), 'a');
      var stderr = fs.openSync(path.join(logpath, 'error.log'), 'a');

      var err;
      var subprocess = spawn(
        vars.telebitNode
      , [ path.join(__dirname, '../../bin/telebitd.js')
        , 'daemon'
        , '--config'
        , vars.telebitdConfig
        ]
      , { detached: true
        , stdio: [ 'ignore', stdout, stderr ]
        }
      );
      subprocess.unref();
      subprocess.on('error', function (_err) {
        err = _err;
      });
      subprocess.on('exit', function (code, signal) {
        if (!err) { err = new Error('' + code + ' ' + signal + ' failure to launch'); }
      });

      setTimeout(function () {
        if (fn) {
          fn(err);
          return;
        }
      }, 1 * 1000);
      return;
    }
  , 'launchctl': function () {
      var launcher = path.join(os.homedir(), 'Library/LaunchAgents/cloud.telebit.remote.plist');
      try {
        mkdirp.sync(path.join(os.homedir(), 'Library/LaunchAgents'));
        mkdirp.sync(path.join(vars.telebitPath, 'bin'));
        mkdirp.sync(vars.TELEBIT_LOG_DIR);
        installLauncher.sync({
            file: {
              tpl: vars.telebitBinTpl
            , launcher: path.join(vars.telebitPath, 'bin/telebit')
          }
        , vars: vars
        });
        installLauncher({
          file: {
              tpl: path.join(vars.telebitPath, 'usr/share/dist/etc/skel/Library/LaunchAgents/cloud.telebit.remote.plist.tpl')
            , launcher: launcher
            }
          , vars: vars
        });
        var launcherstr = (vars.userspace ? "" : "sudo ") + "launchctl ";
        var execstr = launcherstr + "unload -w " + launcher;
        exec(execstr, things._execOpts, function (/*err, stdout, stderr*/) {
          // we probably only need to skip the stderr (saying that it can't stop something that isn't started)
          //err = getError(err, stderr);
          //if (err) { fn(err); return; }
          //console.log((stdout||'').trim());
          //console.log('unload worked?');
          execstr = launcherstr + "load -w " + launcher;
          exec(execstr, things._execOpts, function (err, stdout, stderr) {
            err = getError(err, stderr);
            if (err) { fn(err); return; }
            //console.log((stdout||'').trim());
            //console.log('load worked?');
            fn(null);
          });
        });
      } catch(e) {
        console.error("'" + launcher + "' error:");
        console.error(e);
        if (fn) { fn(e); return; }
      }
    }
   , 'systemctl': function () {
      var launcher = path.join(os.homedir(), '.config/systemd/user/telebit.service');
      try {
        mkdirp.sync(path.join(os.homedir(), '.config/systemd/user'));
        installLauncher({
          file: {
            tpl: path.join(vars.telebitPath, 'usr/share/dist/etc/skel/.config/systemd/user/telebit.service.tpl')
          , launcher: launcher
          }
        , vars: vars
        }, function () {
          var launcherstr = (vars.userspace ? "" : "sudo ") + "systemctl " + (vars.userspace ? "--user " : "");
          exec(launcherstr + "daemon-reload", things._execOpts, function (err, stdout, stderr) {
            err = getError(err, stderr);
            if (err) { fn(err); return; }
            //console.log((stdout||'').trim());
            exec(launcherstr + "enable " + launcher, things._execOpts, function (err, stdout, stderr) {
              err = getError(err, stderr);
              if (err) { fn(err); return; }
              //console.log((stdout||'').trim());
              exec(launcherstr + "restart " + launcher, things._execOpts, function (err, stdout, stderr) {
                err = getError(err, stderr);
                if (err) { fn(err); return; }
                //console.log((stdout||'').trim());
                fn(null);
              });
            });
          });
        });
      } catch(e) {
        console.error("'" + launcher + "' error:");
        console.error(e);
        if (fn) { fn(e); return; }
      }
    }
  , 'reg.exe': function () {
      if (!vars.userspace) {
        console.warn("sysetm-level, privileged services are not yet supported on windows");
      }
      vars.telebitNode += '.exe';
      var cmd = 'reg.exe add "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run"'
        + ' /V "Telebit" /t REG_SZ /D '
        + '"' + things.argv[0] + ' /c '  // something like C:\\Program Files (x64)\nodejs\node.exe
        + [ path.join(__dirname, 'bin/telebitd.js')
          , 'daemon'
          , '--config'
          , path.join(os.homedir(), '.config/telebit/telebitd.yml')
          ].join(' ')
        + '" /F'
        ;
      exec(cmd, things._execOpts, function (err, stdout, stderr) {
        err = getError(err, stderr);
        if (err) { fn(err); return; }
        //console.log((stdout||'').trim());
        fn(null);
      });
    }
  };

  function run(err, launcher) {
    if (err) {
      console.error("No luck with '" + launcher + "', trying a child process instead...");
      console.error(err);
      launcher = 'node';
    }

    if (launchers[launcher]) {
      // console.log('Launching with launcher ' + launcher);
      launchers[launcher]();
      return;
    } else {
      console.error("No launcher handler for '" + launcher+ "'");
    }
  }

  if (things.launcher) {
    if ('string' === typeof things.launcher) {
      run(null, things.launcher);
      return;
    }
    if ('function' === typeof things.launcher) {
      things._vars = vars;
      things._userspace = vars.userspace;
      things.launcher(things);
      return;
    }
  }

  // could have used "command-exists" but I'm trying to stay low-dependency
  // os.platform(), os.type()
  if (!/^win/i.test(os.platform())) {
    if (/^darwin/i.test(os.platform())) {
      exec('type -p launchctl', things._execOpts, function (err, stdout, stderr) {
        err = getError(err, stderr);
        run(err, 'launchctl');
      });
    } else {
      exec('type -p systemctl', things._execOpts, function (err, stdout, stderr) {
        err = getError(err, stderr);
        run(err, 'systemctl');
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
    exec('where reg.exe', things._execOpts, function (err, stdout, stderr) {
      console.log((stdout||'').trim());
      if (stderr) {
        console.error(stderr);
      }
      run(err, 'reg.exe');
    });
  }
};

if (module === require.main) {
  module.exports.install({
    argv: process.argv
  , env: process.env
  }, function (err) {
    if (err) { console.error(err); return; }
    console.log("Telebit launched, or so it seems.");
  });
}

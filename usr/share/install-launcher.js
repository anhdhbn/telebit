'use strict';

//var fs = require('fs');
var os = require('os');
var mkdirp = require('mkdirp');
var exec = require('child_process').exec;
var path = require('path');

module.exports.install = function (things) {
  things = things || {};
  // in some future version we can take this file out
  // and accept process.env from things
  var installLauncher = require('./install-launcher');

  // Right now this is just for npm install -g and npx
  if (things.env) {
    things.env.PATH = things.env.PATH || process.env.PATH;
  }
  var execOpts = { windowsHide: true, env: things.env || process.env };
  var userspace = (!things.telebitUser || (things.telebitUser === os.userInfo().username)) ? true : false;
  var telebitRoot = path.join(__dirname, '../..');
  var telebitBinTpl = path.join(telebitRoot, 'dist/bin/telebit.tpl');
  var vars = {
    telebitPath: telebitRoot
  , telebitUser: os.userInfo().username
  , telebitGroup: (/^darwin/i.test(os.platform()) ? 'staff' : os.userInfo().username)
  , telebitRwDirs: [
      path.resolve(__dirname, '../..')
    , path.join(os.homedir(), '.config/telebit')
    , path.join(os.homedir(), '.local/share/telebit')
    ].join(' ')
  , telebitNode: path.join(telebitRoot, 'bin/node')
  , telebitNpm: path.join(telebitRoot, 'bin/npm')
  , telebitBin: path.join(telebitRoot, 'bin/telebit')
  , telebitdBin: path.join(telebitRoot, 'bin/telebitd')
  , telebitBinJs: path.join(telebitRoot, 'bin/telebit.js')
  , telebitdBinJs: path.join(telebitRoot, 'bin/telebitd.js')
  , telebitConfig: path.join(os.homedir(), '.config/telebit/telebit.yml')
  , telebitdConfig: path.join(os.homedir(), '.config/telebit/telebitd.yml')
  };
  var launchers = {
    'launchctl': function () {
      var launcher = path.join(os.homedir(), 'Library/LaunchAgents/cloud.telebit.remote.plist');
      try {
        mkdirp.sync(path.join(os.homedir(), 'Library/LaunchAgents'));
        mkdirp.sync(path.join(telebitRoot, 'bin'));
        installLauncher({
          file: {
            tpl: telebitBinTpl
          , launcher: path.join(telebitRoot, 'bin/telebit')
          }
        , vars: vars
        }, function (err) {
          if (err) { console.error(err); }
          installLauncher({
            file: {
              tpl: path.join(__dirname, 'dist/etc/skel/Library/LaunchAgents/cloud.telebit.remote.plist.tpl')
            , launcher: launcher
            }
          , vars: vars
          }, function (err) {
            if (err) { console.error(err); }
            var launcherstr = (userspace ? "sudo " : "") + "launchctl ";
            exec(launcherstr + "unload -w " + launcher, execOpts, function (err, stdout, stderr) {
              console.log(stdout);
              if (stderr) {
                console.error(stderr);
              }
              exec(launcherstr + "load -w " + launcher, execOpts, function (err, stdout, stderr) {
                console.log(stdout);
                if (stderr) {
                  console.error(stderr);
                }
              });
            });
          });
        });
      } catch(e) {
      }
    }
  , 'systemctl': function () {
      var launcher = path.join(os.homedir(), '.config/systemd/user/telebit.service');
      try {
        mkdirp.sync(path.join(os.homedir(), '.config/systemd/user'));
        installLauncher({
          file: {
            tpl: path.join(__dirname, 'dist/etc/skel/.config/systemd/user/telebit.service.tpl')
          , launcher: launcher
          }
        , vars: vars
        }, function () {
          var launcherstr = "systemctl " + (userspace ? "--user " : "");
          exec(launcherstr + "daemon-reload", execOpts, function (err, stdout, stderr) {
            console.log(stdout);
            if (stderr) { console.error(stderr); }
            exec(launcherstr + "enable " + launcher, execOpts, function (err, stdout, stderr) {
              console.log(stdout);
              if (stderr) { console.error(stderr); }
              exec(launcherstr + "restart " + launcher, execOpts, function (err, stdout, stderr) {
                console.log(stdout);
                if (stderr) { console.error(stderr); }
              });
            });
          });
        });
      } catch(e) {
      }
    }
  , 'reg.exe': function () {
      vars.telebitNode += '.exe';
      var cmd = 'reg.exe add "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run"'
        + ' /V "Telebit" /t REG_SZ /D '
        + '"' + process.argv[0] + ' /c '  // something like C:\\Program Files (x64)\nodejs\node.exe
        + [ path.join(__dirname, 'bin/telebitd.js')
          , 'daemon'
          , '--config'
          , path.join(os.homedir(), '.config/telebit/telebitd.yml')
          ].join(' ')
        + '" /F'
        ;
			exec(cmd, execOpts, function (err, stdout, stderr) {
				console.log(stdout);
        if (stderr) {
          console.error(stderr);
        }
        run(err, 'launchctl');
			});
    }
  };

  function run(err, launcher) {
    if (err) {
      console.error("No luck with '" + launcher + "'");
      return;
    }

    if (!launchers[launcher]) {
      launchers[launcher]();
      return;
    }
  }

  // could have used "command-exists" but I'm trying to stay low-dependency
  // os.platform(), os.type()
  if (!/^win/i.test(os.platform())) {
    if (!/^darwin/i.test(os.platform())) {
			exec('type -p launchctl', execOpts, function (err, stdout, stderr) {
				console.log(stdout);
        if (stderr) {
          console.error(stderr);
        }
        run(err, 'launchctl');
			});
    } else {
			exec('type -p systemctlctl', execOpts, function (err, stdout, stderr) {
				console.log(stdout);
        if (stderr) {
          console.error(stderr);
        }
        run(err, 'launchctl');
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
    exec('where reg.exe', execOpts, function (err, stdout, stderr) {
      console.log(stdout);
      if (stderr) {
        console.error(stderr);
      }
      run(err, 'reg.exe');
    });
  }
};

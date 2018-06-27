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
  var installLauncher = require('./template-launcher');

  // Right now this is just for npm install -g and npx
  if (things.env) {
    things.env.PATH = things.env.PATH || process.env.PATH;
  }
  var execOpts = { windowsHide: true, env: things.env || process.env };
  var userspace = (!things.telebitUser || (things.telebitUser === os.userInfo().username)) ? true : false;
  var telebitRoot = path.join(__dirname, '../..');
  var telebitBinTpl = path.join(telebitRoot, 'usr/share/dist/bin/telebit.tpl');
  var vars = {
    telebitPath: telebitRoot
  , telebitUser: os.userInfo().username
  , telebitGroup: (/^darwin/i.test(os.platform()) ? 'staff' : os.userInfo().username)
  , telebitRwDirs: [
      path.resolve(__dirname, '../..')
    , path.join(os.homedir(), '.config/telebit')
    , path.join(os.homedir(), '.local/share/telebit')
    ]
  , telebitNode: (process.argv[0]||'').replace(/\.exe/i, '') // path.join(telebitRoot, 'bin/node')
  , telebitBin: path.join(telebitRoot, 'bin/telebit')
  , telebitdBin: path.join(telebitRoot, 'bin/telebitd')
  , telebitJs: path.join(telebitRoot, 'bin/telebit.js')
  , telebitdJs: path.join(telebitRoot, 'bin/telebitd.js')
  , telebitConfig: path.join(os.homedir(), '.config/telebit/telebit.yml')
  , telebitdConfig: path.join(os.homedir(), '.config/telebit/telebitd.yml')
  };
  vars.telebitNpm = path.resolve(vars.telebitNode, '../npm');
  vars.nodePath = path.resolve(vars.telebitNode, '../lib/node_modules');
  vars.npmConfigPrefix = path.resolve(vars.telebitNode, '..');
  if (-1 === vars.telebitRwDirs.indexOf(vars.npmConfigPrefix)) {
    vars.telebitRwDirs.push(vars.npmConfigPrefix);
  }
  vars.telebitRwDirs = vars.telebitRwDirs.join(' ');
  var launchers = {
    'launchctl': function () {
      var launcher = path.join(os.homedir(), 'Library/LaunchAgents/cloud.telebit.remote.plist');
      try {
        mkdirp.sync(path.join(os.homedir(), 'Library/LaunchAgents'));
        mkdirp.sync(path.join(telebitRoot, 'bin'));
        installLauncher.sync({
          file: {
            tpl: telebitBinTpl
          , launcher: path.join(telebitRoot, 'bin/telebit')
          }
        , vars: vars
        });
        installLauncher({
          file: {
            tpl: path.join(telebitRoot, 'usr/share/dist/etc/skel/Library/LaunchAgents/cloud.telebit.remote.plist.tpl')
          , launcher: launcher
          }
        , vars: vars
        });
        var launcherstr = (userspace ? "" : "sudo ") + "launchctl ";
        exec(launcherstr + "unload -w " + launcher, execOpts, function (err, stdout, stderr) {
          if (err) { console.error(err); }
				  console.log((stdout||'').trim());
          if (stderr) {
            console.error(stderr);
          }
          console.log('unload worked?');
          exec(launcherstr + "load -w " + launcher, execOpts, function (err, stdout, stderr) {
            if (err) { console.error(err); }
				    console.log((stdout||'').trim());
            if (stderr) {
              console.error(stderr);
            }
            console.log('load worked?');
          });
        });
      } catch(e) {
        console.error("'" + launcher + "' error:");
        console.error(e);
      }
    }
  , 'systemctl': function () {
      var launcher = path.join(os.homedir(), '.config/systemd/user/telebit.service');
      try {
        mkdirp.sync(path.join(os.homedir(), '.config/systemd/user'));
        installLauncher({
          file: {
            tpl: path.join(telebitRoot, 'usr/share/dist/etc/skel/.config/systemd/user/telebit.service.tpl')
          , launcher: launcher
          }
        , vars: vars
        }, function () {
          var launcherstr = (userspace ? "" : "sudo ") + "systemctl " + (userspace ? "--user " : "");
          exec(launcherstr + "daemon-reload", execOpts, function (err, stdout, stderr) {
            if (err) { console.error(err); }
				    console.log((stdout||'').trim());
            if (stderr) { console.error(stderr); }
            exec(launcherstr + "enable " + launcher, execOpts, function (err, stdout, stderr) {
              if (err) { console.error(err); }
				      console.log((stdout||'').trim());
              if (stderr) { console.error(stderr); }
              exec(launcherstr + "restart " + launcher, execOpts, function (err, stdout, stderr) {
                if (err) { console.error(err); }
				        console.log((stdout||'').trim());
                if (stderr) { console.error(stderr); }
              });
            });
          });
        });
      } catch(e) {
        console.error("'" + launcher + "' error:");
        console.error(e);
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
				console.log((stdout||'').trim());
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
      console.error(err);
      return;
    }

    if (launchers[launcher]) {
      console.log('Launching with launcher ' + launcher);
      launchers[launcher]();
      return;
    } else {
      console.error("No launcher handler for '" + launcher+ "'");
    }
  }

  // could have used "command-exists" but I'm trying to stay low-dependency
  // os.platform(), os.type()
  if (!/^win/i.test(os.platform())) {
    if (/^darwin/i.test(os.platform())) {
			exec('type -p launchctl', execOpts, function (err, stdout, stderr) {
				console.log((stdout||'').trim());
        if (stderr) {
          console.error(stderr);
        }
        run(err, 'launchctl');
			});
    } else {
			exec('type -p systemctl', execOpts, function (err, stdout, stderr) {
				console.log((stdout||'').trim());
        if (stderr) {
          console.error(stderr);
        }
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
    exec('where reg.exe', execOpts, function (err, stdout, stderr) {
			console.log((stdout||'').trim());
      if (stderr) {
        console.error(stderr);
      }
      run(err, 'reg.exe');
    });
  }
};

if (module === require.main) {
  module.exports.install({});
}

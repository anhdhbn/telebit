'use strict';

//var fs = require('fs');
var os = require('os');
var mkdirp = require('mkdirp');
var exec = require('child_process').exec;
var path = require('path');

var Launcher = module.exports;
Launcher._killAll = function (fn) {
  var psList = require('ps-list');
  psList().then(function (procs) {
    procs.forEach(function (proc) {
      if ('node' === proc.name && /\btelebitd\b/i.test(proc.cmd)) {
        console.log(proc);
        process.kill(proc.pid);
        return true;
      }
    });
    // Two things:
    // 1) wait to see if the process dies
    // 2) wait to give time for the socket to connect
    setTimeout(function () {
      if (fn) { fn(null); return; }
    }, 1.75 * 1000);
  });
};
Launcher._getError = function getError(err, stderr) {
  if (err) { return err; }
  if (stderr) {
    err = new Error(stderr);
    err.code = 'ELAUNCHER';
    return err;
  }
};
Launcher._detect = function (things, fn) {
  if (things.launcher) {
    if ('string' === typeof things.launcher) {
      fn(null, things.launcher);
      return;
    }
    if ('function' === typeof things.launcher) {
      things.launcher(things);
      return;
    }
  }

  // could have used "command-exists" but I'm trying to stay low-dependency
  // os.platform(), os.type()
  if (!/^win/i.test(os.platform())) {
    if (/^darwin/i.test(os.platform())) {
      exec('command -v launchctl', things._execOpts, function (err, stdout, stderr) {
        err = Launcher._getError(err, stderr);
        fn(err, 'launchctl');
      });
    } else {
      exec('command -v systemctl', things._execOpts, function (err, stdout, stderr) {
        err = Launcher._getError(err, stderr);
        fn(err, 'systemctl');
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
      //console.log((stdout||'').trim());
      if (stderr) {
        console.error(stderr);
      }
      fn(err, 'reg.exe');
    });
  }
};
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
      telebitRoot
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
  , TELEBIT_SOCK_DIR: path.join(os.homedir(), '.local/share/telebit/var/run')
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

      var killed = 0;
      var err;
      var args = [
        path.join(telebitRoot, 'bin/telebitd.js')
      , 'daemon'
      , '--config'
      , vars.telebitdConfig
      ];
      var subprocess = spawn(
        vars.telebitNode
      , args
      , { detached: true
        , stdio: [ 'ignore', stdout, stderr ]
        }
      );
      //console.log('[debug]', vars.telebitNode, args.join(' '));
      subprocess.unref();
      subprocess.on('error', function (_err) {
        err = _err;
        killed += 1;
      });
      subprocess.on('exit', function (code, signal) {
        if (!err) { err = new Error('' + code + ' ' + signal + ' failure to launch'); }
        killed += 1;
      });

      // Two things:
      // 1) wait to see if the process dies
      // 2) wait to give time for the socket to connect
      setTimeout(function () {
        if (fn) { fn(err); return; }
      }, 1.75 * 1000);
      return;
    }
  , 'launchctl': function () {
      var launcher = path.join(os.homedir(), 'Library/LaunchAgents/cloud.telebit.remote.plist');
      try {
        mkdirp.sync(path.join(os.homedir(), 'Library/LaunchAgents'));
        installLauncher.sync({
            file: {
              tpl: vars.telebitBinTpl
            , launcher: path.join(vars.telebitPath, 'bin/telebit')
            , executable: true
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
          //err = Launcher._getError(err, stderr);
          //if (err) { fn(err); return; }
          //console.log((stdout||'').trim());
          //console.log('unload worked?');
          execstr = launcherstr + "load -w " + launcher;
          exec(execstr, things._execOpts, function (err, stdout, stderr) {
            err = Launcher._getError(err, stderr);
            if (err) { fn(err); return; }
            //console.log((stdout||'').trim());
            //console.log('load worked?');
            setTimeout(function () {
              fn(null);
            }, 1.25 * 1000);
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
      var launchername = 'telebit.service';
      try {
        mkdirp.sync(path.join(os.homedir(), '.config/systemd/user'));
        installLauncher({
          file: {
            tpl: path.join(vars.telebitPath, 'usr/share/dist/etc/skel/.config/systemd/user/telebit.service.tpl')
          , launcher: launcher
          }
        , vars: vars
        }, function () {
          // IMPORTANT
          // It's a dangerous to go alone, take this:
          // SYSTEMD_LOG_LEVEL=debug journalctl -xef --user-unit=telebit
          // (makes debugging systemd issues not "easy" per se, but possible)
          var launcherstr = (vars.userspace ? "" : "sudo ") + "systemctl " + (vars.userspace ? "--user " : "");
          var execstr = launcherstr + "daemon-reload";
          exec(execstr, things._execOpts, function (err, stdout, stderr) {
            err = Launcher._getError(err, stderr);
            if (err) { fn(err); return; }
            //console.log((stdout||'').trim());
            var execstr = launcherstr + "enable " + launchername;
            exec(execstr, things._execOpts, function (err, stdout, stderr) {
              err = Launcher._getError(err, stderr && !/Created symlink/i.test(stderr) && stderr || '');
              if (err) { fn(err); return; }
              //console.log((stdout||'').trim());
              var execstr = launcherstr + "restart " + launchername;
              exec(execstr, things._execOpts, function (err, stdout, stderr) {
                err = Launcher._getError(err, stderr);
                if (err) { fn(err); return; }
                //console.log((stdout||'').trim());
                setTimeout(function () {
                  var execstr = launcherstr + "status " + launchername;
                  exec(execstr, things._execOpts, function (err, stdout, stderr) {
                    err = Launcher._getError(err, stderr);
                    if (err) { fn(err); return; }
                    if (!/active.*running/i.test(stdout)) {
                      err = new Error("systemd failed to start '" + launchername + "'");
                    }
                    if (err) { fn(err); return; }
                    //console.log((stdout||'').trim());
                    fn(null);
                  });
                }, 1.25 * 1000);
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
        err = Launcher._getError(err, stderr);
        if (err) { fn(err); return; }
        // need to start it for the first time ourselves
        run(null, 'node');
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
      mkdirp.sync(path.join(vars.telebitPath, 'bin'));
      mkdirp.sync(vars.TELEBIT_LOG_DIR);
      mkdirp.sync(vars.TELEBIT_SOCK_DIR);
      launchers[launcher]();
      return;
    } else {
      console.error("No launcher handler for '" + launcher+ "'");
    }
  }

  things._vars = vars;
  things._userspace = vars.userspace;
  Launcher._detect(things, run);
};
Launcher.uninstall = function (things, fn) {
  if (!fn) { fn = function (err) { if (err) { console.error(err); } }; }
  things = things || {};

  // Right now this is just for npm install -g and npx
  if (things.env) {
    things.env.PATH = things.env.PATH || process.env.PATH;
  } else {
    things.env = process.env;
  }
  things.argv = things.argv || process.argv;
  things._execOpts = { windowsHide: true, env: things.env };
  var vars = {
    telebitUser: os.userInfo().username
  };
  vars.userspace = (!things.telebitUser || (things.telebitUser === os.userInfo().username)) ? true : false;
  var launchers = {
    'node': function () {
      Launcher._killAll(fn);
    }
  , 'launchctl': function () {
      var launcher = path.join(os.homedir(), 'Library/LaunchAgents/cloud.telebit.remote.plist');
      try {
        var launcherstr = (vars.userspace ? "" : "sudo ") + "launchctl ";
        var execstr = launcherstr + "unload -w " + launcher;
        exec(execstr, things._execOpts, function (err, stdout, stderr) {
          // we probably only need to skip the stderr (saying that it can't stop something that isn't started)
          //err = Launcher._getError(err, stderr);
          //if (err) { fn(err); return; }
          //console.log((stdout||'').trim());
          //console.log('unload worked?');
          err = Launcher._getError(err, stderr);
          if (err) { fn(err); return; }
          //console.log((stdout||'').trim());
          //console.log('load worked?');
          setTimeout(function () {
            fn(null);
          }, 1.25 * 1000);
        });
      } catch(e) {
        console.error("'" + launcher + "' error (uninstall):");
        console.error(e);
        if (fn) { fn(e); return; }
      }
    }
   , 'systemctl': function () {
      var launcher = path.join(os.homedir(), '.config/systemd/user/telebit.service');
      var launchername = 'telebit.service';
      try {
        mkdirp.sync(path.join(os.homedir(), '.config/systemd/user'));
        // IMPORTANT
        // It's a dangerous to go alone, take this:
        // SYSTEMD_LOG_LEVEL=debug journalctl -xef --user-unit=telebit
        // (makes debugging systemd issues not "easy" per se, but possible)
        var launcherstr = (vars.userspace ? "" : "sudo ") + "systemctl " + (vars.userspace ? "--user " : "");
        var execstr = launcherstr + "disable " + launchername;
        exec(execstr, things._execOpts, function (err, stdout, stderr) {
          err = Launcher._getError(err, stderr && !/Removed symlink/i.test(stderr) && stderr || '');
          if (err) { fn(err); return; }
          //console.log((stdout||'').trim());
          var execstr = launcherstr + "stop " + launchername;
          exec(execstr, things._execOpts, function (err, stdout, stderr) {
            err = Launcher._getError(err, stderr);
            if (err) { fn(err); return; }
            //console.log((stdout||'').trim());
            setTimeout(function () {
              var execstr = launcherstr + "status " + launchername;
              exec(execstr, things._execOpts, function (err, stdout, stderr) {
                err = Launcher._getError(err, stderr);
                if (err) { fn(err); return; }
                if (!/inactive.*dead/i.test(stdout)) {
                  err = new Error("systemd failed to stop '" + launchername + "'");
                }
                if (err) { fn(err); return; }
                //console.log((stdout||'').trim());
                fn(null);
              });
            }, 1.25 * 1000);
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
      var cmd = 'reg.exe add "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run"'
        + ' /V "Telebit" /F'
        ;
      exec(cmd, things._execOpts, function (err, stdout, stderr) {
        err = Launcher._getError(err, stderr);
        if (err) { fn(err); return; }
        // need to start it for the first time ourselves
        kill(null, 'node');
      });
    }
  };

  function kill(err, launcher) {
    if (err) {
      console.error("No luck with '" + launcher + "', trying a process.kill() instead...");
      console.error(err);
      launcher = 'node';
    }

    if (launchers[launcher]) {
      launchers[launcher]();
      return;
    } else {
      console.error("No launcher handler (uninstall) for '" + launcher + "'");
    }
  }

  things._vars = vars;
  things._userspace = vars.userspace;
  Launcher._detect(things, kill);
};

if (module === require.main) {
  Launcher.install({
    argv: process.argv
  , env: process.env
  }, function (err) {
    if (err) { console.error(err); return; }
    console.log("Telebit launched, or so it seems.");
  });
}

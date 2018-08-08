'use strict';

module.exports = function (pkg) {
  function checkUpgrade() {
    var https = require('https');

    function getFile(url, cb) {
      https.get(url, function (resp) {
        var str = '';
        resp.on('data', function (chunk) {
          //var chunk = conn.read();
          str += chunk.toString('utf8');
        });
        resp.on('end', function () {
          cb(null, str);
        });
        resp.on('error', function (err) {
          // ignore
          cb(err);
        });
      }).on('error', function (err) {
        // ignore
        cb(err);
      });
    }

    function isNewer(latest, myPkg) {
      //console.log('sort result:', sortLatest(latest, myPkg));
      return sortLatest(latest, myPkg) < 0;
    }
    function sortLatest(latest, myPkg) {
      var m = /^(v)?(\d+)\.(\d+)\.(\d+)(.*)/.exec(latest);
      var n = /^(v)?(\d+)\.(\d+)\.(\d+)(.*)/.exec(myPkg);
      //console.log('m', m);
      //console.log('n', n);
      if (!m) {
        if (!n) {
          return 0;
        }
        return 1;
      } else if (!n) {
        return -1;
      }

      if (parseInt(m[2], 10) > parseInt(n[2], 10)) {
        return -1;
      } else if (parseInt(m[2], 10) === parseInt(n[2], 10)) {
        if (parseInt(m[3], 10) > parseInt(n[3], 10)) {
          return -1;
        } else if (parseInt(m[3], 10) === parseInt(n[3], 10)) {
          if (parseInt(m[4], 10) > parseInt(n[4], 10)) {
            return -1;
          } else if (parseInt(m[4], 10) === parseInt(n[4], 10)) {
            // lex sorting
            if (m[5] > n[5]) {
              return -1;
            } else if (m[5] === n[5]) {
              return 0;
            } else {
              return 1;
            }
          } else {
            return 1;
          }
        } else {
          return 1;
        }
      } else {
        return 1;
      }
    }

    getFile("https://telebit.cloud/dist/index.tab", function (err, tab) {
      if (err) { /*ignore*/ return; }
      if (tab) { tab = tab && tab.toString() || ''; }
      var versions = [];
      var lines = tab.split(/[\r\n]/g);
      var headers = lines.shift().split(/\t/g);
      var chan = 'prod';
      var next;
      lines.forEach(function (line) {
        var tsv = {};
        var fields = line.split(/\t/g);
        fields.forEach(function (value, i) {
          tsv[headers[i]] = value;
        });
        versions.push(tsv);
      });
      // find matching version
      versions.some(function (v) {
        if (('v' + pkg.version) === v.version) {
          chan = v.channel;
          return true;
        }
      });
      // find first (most recent) version in channel
      versions.some(function (v) {
        if (chan === v.channel) {
          next = v;
          return true;
        }
      });
      if (!next || !isNewer(next.version, pkg.version)) {
        //console.log('DEBUG can\'t upgrade from', pkg.version, 'in channel', chan);
        return;
      }
      console.log('Upgrade Available: ' + next.version + ' in \'' + next.channel + '\'channel');
      getFile("https://telebit.cloud/dist/upgrade.js", function (err, script) {
        if (err) { /*ignore*/ return; }
        var os = require('os');
        var fs = require('fs');
        var path = require('path');
        var scriptname = 'telebit-upgrade-' + Math.round(Math.random() * 99999) + '.js';
        var pathname = path.join(os.tmpdir(), scriptname);
        fs.writeFile(pathname, script, function (err) {
          if (err) { /*ignore*/ return; }
          // console.log('DEBUG wrote', pathname);
          //var str =
          require(pathname)({
            package: pkg
          , root: path.resolve(__dirname, '..')
          , latest: next
          , channel: chan
          }, function () {
            // console.log('upgrade complete');
          });
          //console.log(str);
        });
      });
    });
  }

  var _interval = setInterval(checkUpgrade, 2 * 60 * 60 * 1000);
  process.nextTick(function () {
    checkUpgrade();
  });

  return function cancel() {
    clearInterval(_interval);
  };
};

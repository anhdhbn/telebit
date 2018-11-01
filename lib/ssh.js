'use strict';

/*global Promise*/
var PromiseA = Promise;
var crypto = require('crypto');
var util = require('util');
var readFile = util.promisify(require('fs').readFile);
var exec = require('child_process').exec;

function sshAllowsPassword(user) {
  // SSH on Windows is a thing now (beta 2015, standard 2018)
  // https://stackoverflow.com/questions/313111/is-there-a-dev-null-on-windows
  var nullfile = '/dev/null';
  if (/^win/i.test(process.platform)) {
    nullfile = 'NUL';
  }
  var args = [
    'ssh', '-v', '-n'
  , '-o', 'Batchmode=yes'
  , '-o', 'StrictHostKeyChecking=no'
  , '-o', 'UserKnownHostsFile=' + nullfile
  , user + '@localhost'
  , '| true'
  ];
  return new PromiseA(function (resolve) {
    // not using promisify because all 3 arguments convey information
    exec(args.join(' '), function (err, stdout, stderr) {
      stdout = (stdout||'').toString('utf8');
      stderr = (stderr||'').toString('utf8');
      if (/\bpassword\b/.test(stdout) || /\bpassword\b/.test(stderr)) {
        resolve('yes');
        return;
      }
      if (/\bAuthentications\b/.test(stdout) || /\bAuthentications\b/.test(stderr)) {
        resolve('no');
        return;
      }
      resolve('maybe');
    });
  });
}

module.exports.checkSecurity = function () {
  var conf = {};
  var sshdConf = '/etc/ssh/sshd_config';
  var noRootPasswordRe = /(?:^|[\r\n]+)\s*PermitRootLogin\s+(prohibit-password|without-password|no)\s*/i;
  var noPasswordRe = /(?:^|[\r\n]+)\s*PasswordAuthentication\s+(no)\s*/i;
  return readFile(sshdConf, null).then(function (sshd) {
    sshd = sshd.toString('utf8');
    var match;
    match = sshd.match(noRootPasswordRe);
    conf.permit_root_login = match ? match[1] : 'yes';
    match = sshd.match(noPasswordRe);
    conf.password_authentication = match ? match[1] : 'yes';
  }).catch(function () {
    // ignore error as that might not be the correct sshd_config location
  }).then(function () {
    var doesntExist = crypto.randomBytes(16).toString('hex');
    return sshAllowsPassword(doesntExist).then(function (maybe) {
      conf.requests_password = maybe;
    });
  }).then(function () {
    return conf;
  });
};

if (require.main === module) {
  module.exports.checkSecurity().then(function (conf) {
    console.log(conf);
    return conf;
  });
}

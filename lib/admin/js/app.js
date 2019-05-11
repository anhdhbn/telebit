;(function () {
'use strict';

var Vue = window.Vue;
var Telebit = window.TELEBIT;
var Keypairs = window.Keypairs;
var api = {};

/*
function safeFetch(url, opts) {
  var controller = new AbortController();
  var tok = setTimeout(function () {
    controller.abort();
  }, 4000);
  if (!opts) {
    opts = {};
  }
  opts.signal = controller.signal;
  return window.fetch(url, opts).finally(function () {
    clearTimeout(tok);
  });
}
*/

api.config = function apiConfig() {
  return Telebit.reqLocalAsync({
    url: "/api/config"
  , method: "GET"
  }).then(function (resp) {
    var json = resp.body;
    appData.config = json;
    return json;
  });
};
api.status = function apiStatus() {
  return Telebit.reqLocalAsync({ url: "/api/status", method: "GET" }).then(function (resp) {
    var json = resp.body;
    return json;
  });
};
api.http = function apiHttp(o) {
  var opts = {
    url: "/api/http"
  , method: "POST"
  , headers: { 'Content-Type': 'application/json' }
  , json: { name: o.name, handler: o.handler, indexes: o.indexes }
  };
  return Telebit.reqLocalAsync(opts).then(function (resp) {
    var json = resp.body;
    appData.initResult = json;
    return json;
  }).catch(function (err) {
    window.alert("Error: [init] " + (err.message || JSON.stringify(err, null, 2)));
  });
};
api.ssh = function apiSsh(port) {
  var opts = {
    url: "/api/ssh"
  , method: "POST"
  , headers: { 'Content-Type': 'application/json' }
  , json: { port: port }
  };
  return Telebit.reqLocalAsync(opts).then(function (resp) {
    var json = resp.body;
    appData.initResult = json;
    return json;
  }).catch(function (err) {
    window.alert("Error: [init] " + (err.message || JSON.stringify(err, null, 2)));
  });
};
api.enable = function apiEnable() {
  var opts = {
    url: "/api/enable"
  , method: "POST"
  //, headers: { 'Content-Type': 'application/json' }
  };
  return Telebit.reqLocalAsync(opts).then(function (resp) {
    var json = resp.body;
    console.log('enable', json);
    return json;
  }).catch(function (err) {
    window.alert("Error: [enable] " + (err.message || JSON.stringify(err, null, 2)));
  });
};
api.disable = function apiDisable() {
  var opts = {
    url: "/api/disable"
  , method: "POST"
  //, headers: { 'Content-Type': 'application/json' }
  };
  return Telebit.reqLocalAsync(opts).then(function (resp) {
    var json = resp.body;
    console.log('disable', json);
    return json;
  }).catch(function (err) {
    window.alert("Error: [disable] " + (err.message || JSON.stringify(err, null, 2)));
  });
};

function showOtp(otp, pollUrl) {
  localStorage.setItem('poll_url', pollUrl);
  telebitState.pollUrl = pollUrl;
  appData.init.otp = otp;
  changeState('otp');
}
function doConfigure() {
  if (telebitState.dir.pair_request) {
    telebitState._can_pair = true;
  }

  //
  // Read config from form
  //

  // Create Empty Config, If Necessary
  if (!telebitState.config) { telebitState.config = {}; }
  if (!telebitState.config.greenlock) { telebitState.config.greenlock = {}; }

  // Populate Config
  if (appData.init.teletos && appData.init.letos) { telebitState.config.agreeTos = true; }
  if (appData.init.relay) { telebitState.config.relay = appData.init.relay; }
  if (appData.init.email) { telebitState.config.email = appData.init.email; }
  if ('undefined' !== typeof appData.init.letos) { telebitState.config.greenlock.agree = appData.init.letos; }
  if ('newsletter' === appData.init.notifications) {
    telebitState.config.newsletter = true; telebitState.config.communityMember = true;
  }
  if ('important' === appData.init.notifications) { telebitState.config.communityMember = true; }
  if (appData.init.acmeVersion) { telebitState.config.greenlock.version = appData.init.acmeVersion; }
  if (appData.init.acmeServer) { telebitState.config.greenlock.server = appData.init.acmeServer; }

  // Temporary State
  telebitState._otp = Telebit.otp();
  appData.init.otp = telebitState._otp;

  return Telebit.authorize(telebitState, showOtp).then(function () {
    return changeState('status');
  });
}

// TODO test for internet connectivity (and telebit connectivity)
var DEFAULT_RELAY = 'telebit.cloud';
var BETA_RELAY = 'telebit.ppl.family';
var TELEBIT_RELAYS = [
  DEFAULT_RELAY
, BETA_RELAY
];
var PRODUCTION_ACME = 'https://acme-v02.api.letsencrypt.org/directory';
var STAGING_ACME = 'https://acme-staging-v02.api.letsencrypt.org/directory';
var appData = {
  config: {}
, status: {}
, init: {
    teletos: true
  , letos: true
  , notifications: "important"
  , relay: DEFAULT_RELAY
  , telemetry: true
  , acmeServer: PRODUCTION_ACME
  }
, state: {}
, views: {
    flash: {
      error: ""
    }
  , section: {
      loading: true
    , setup: false
    , advanced: false
    , otp: false
    , status: false
    }
  }
, newHttp: {}
};
var telebitState = {};
var appMethods = {
  initialize: function () {
    console.log("call initialize");
    if (!appData.init.relay) {
      appData.init.relay = DEFAULT_RELAY;
    }
    appData.init.relay = appData.init.relay.toLowerCase();
    telebitState = { relay: appData.init.relay };

    return Telebit.api.directory(telebitState).then(function (dir) {
      if (!dir.api_host) {
        window.alert("Error: '" + telebitState.relay + "' does not appear to be a valid telebit service");
        return;
      }

      telebitState.dir = dir;

      // If it's one of the well-known relays
      if (-1 !== TELEBIT_RELAYS.indexOf(appData.init.relay)) {
        return doConfigure();
      } else {
        changeState('advanced');
      }
    }).catch(function (err) {
      console.error(err);
      window.alert("Error: [initialize] " + (err.message || JSON.stringify(err, null, 2)));
    });
  }
, advance: function () {
    return doConfigure();
  }
, productionAcme: function () {
    console.log("prod acme:");
    appData.init.acmeServer = PRODUCTION_ACME;
    console.log(appData.init.acmeServer);
  }
, stagingAcme: function () {
    console.log("staging acme:");
    appData.init.acmeServer = STAGING_ACME;
    console.log(appData.init.acmeServer);
  }
, defaultRelay: function () {
    appData.init.relay = DEFAULT_RELAY;
  }
, betaRelay: function () {
    appData.init.relay = BETA_RELAY;
  }
, enable: function () {
    api.enable();
  }
, disable: function () {
    api.disable();
  }
, ssh: function (port) {
    // -1 to disable
    // 0 is auto (22)
    // 1-65536
    api.ssh(port || 22);
  }
, createShare: function (sub, domain, handler) {
    if (sub) {
      domain = sub + '.' + domain;
    }
    api.http({ name: domain, handler: handler, indexes: true });
    appData.newHttp = {};
  }
, createHost: function (sub, domain, handler) {
    if (sub) {
      domain = sub + '.' + domain;
    }
    api.http({ name: domain, handler: handler, 'x-forwarded-for': name });
    appData.newHttp = {};
  }
, changePortForward: function (domain, port) {
    api.http({ name: domain.name, handler: port });
  }
, deletePortForward: function (domain) {
    api.http({ name: domain.name, handler: 'none' });
  }
, changePathHost: function (domain, path) {
    api.http({ name: domain.name, handler: path });
  }
, deletePathHost: function (domain) {
    api.http({ name: domain.name, handler: 'none' });
  }
, changeState: changeState
};
var appStates = {
  setup: function () {
    appData.views.section = { setup: true };
  }
, advanced: function () {
    appData.views.section = { advanced: true };
  }
, otp: function () {
    appData.views.section = { otp: true };
  }
, status: function () {
    function exitState() {
      clearInterval(tok);
    }

    var tok = setInterval(updateStatus, 2000);

    return updateStatus().then(function () {
      appData.views.section = { status: true, status_chooser: true };
      return exitState;
    });
  }
};
appStates.status.share = function () {
  function exitState() {
    clearInterval(tok);
  }

  var tok = setInterval(updateStatus, 2000);

  appData.views.section = { status: true, status_share: true };
  return updateStatus().then(function () {
    return exitState;
  });
};
appStates.status.host = function () {
  function exitState() {
    clearInterval(tok);
  }

  var tok = setInterval(updateStatus, 2000);

  appData.views.section = { status: true, status_host: true };
  return updateStatus().then(function () {
    return exitState;
  });
};
appStates.status.access = function () {
  function exitState() {
    clearInterval(tok);
  }

  var tok = setInterval(updateStatus, 2000);

  appData.views.section = { status: true, status_access: true };
  return updateStatus().then(function () {
    return exitState;
  });
};

function updateStatus() {
  return api.status().then(function (status) {
    if (status.error) {
      appData.views.flash.error = status.error.message || JSON.stringify(status.error, null, 2);
    }
    var wilddomains = [];
    var rootdomains = [];
    var subdomains = [];
    var directories = [];
    var portforwards = [];
    var free = [];
    appData.status = status;
    if ('maybe' === status.ssh_requests_password) {
      appData.status.ssh_active = false;
    } else {
      appData.status.ssh_active = true;
      if ('yes' === status.ssh_requests_password) {
        appData.status.ssh_insecure = true;
      }
    }
    if ('yes' === status.ssh_password_authentication) {
      appData.status.ssh_insecure = true;
    }
    if ('yes' === status.ssh_permit_root_login) {
      appData.status.ssh_insecure = true;
    }

    // only update what's changed
    if (appData.state.ssh !== appData.status.ssh) {
      appData.state.ssh = appData.status.ssh;
    }
    if (appData.state.ssh_insecure !== appData.status.ssh_insecure) {
      appData.state.ssh_insecure = appData.status.ssh_insecure;
    }
    if (appData.state.ssh_active !== appData.status.ssh_active) {
      appData.state.ssh_active = appData.status.ssh_active;
    }
    Object.keys(appData.status.servernames).forEach(function (k) {
      var s = appData.status.servernames[k];
      s.name = k;
      if (s.wildcard) { wilddomains.push(s); }
      if (!s.sub && !s.wildcard) { rootdomains.push(s); }
      if (s.sub) { subdomains.push(s); }
      if (s.handler) {
        if (s.handler.toString() === parseInt(s.handler, 10).toString()) {
          s._port = s.handler;
          portforwards.push(s);
        } else {
          s.path = s.handler;
          directories.push(s);
        }
      } else {
        free.push(s);
      }
    });
    appData.status.portForwards = portforwards;
    appData.status.pathHosting = directories;
    appData.status.wildDomains = wilddomains;
    appData.newHttp.name = (appData.status.wildDomains[0] || {}).name;
    appData.state.ssh = (appData.status.ssh > 0) && appData.status.ssh || undefined;
  });
}

function changeState(newstate) {
  var newhash = '#/' + newstate + '/';
  if (location.hash === newhash) {
    if (!telebitState.firstState) {
      telebitState.firstState = true;
      setState();
    }
  }
  location.hash = newhash;
}
/*globals Promise*/
window.addEventListener('hashchange', setState, false);
function setState(/*ev*/) {
  //ev.oldURL
  //ev.newURL
  if (appData.exit) {
    console.log('previous state exiting');
    appData.exit.then(function (exit) {
      if ('function' === typeof exit) {
        exit();
      }
    });
  }
  var parts = location.hash.substr(1).replace(/^\//, '').replace(/\/$/, '').split('/').filter(Boolean);
  var fn = appStates;
  parts.forEach(function (s) {
    console.log("state:", s);
    fn = fn[s];
  });
  appData.exit = Promise.resolve(fn());
  //appMethods.states[newstate]();
}

function msToHumanReadable(ms) {
  var uptime = ms;
  var uptimed = uptime / 1000;
  var minute = 60;
  var hour = 60 * minute;
  var day = 24 * hour;
  var days = 0;
  var times = [];
  while (uptimed > day) {
    uptimed -= day;
    days += 1;
  }
  times.push(days + " days ");
  var hours = 0;
  while (uptimed > hour) {
    uptimed -= hour;
    hours += 1;
  }
  times.push(hours.toString().padStart(2, "0") + " h ");
  var minutes = 0;
  while (uptimed > minute) {
    uptimed -= minute;
    minutes += 1;
  }
  times.push(minutes.toString().padStart(2, "0") + " m ");
  var seconds = Math.round(uptimed);
  times.push(seconds.toString().padStart(2, "0") + " s ");
  return times.join('');
}

new Vue({
  el: ".v-app"
, data: appData
, computed: {
    statusProctime: function () {
      return msToHumanReadable(this.status.proctime);
    }
  , statusRuntime: function () {
      return msToHumanReadable(this.status.runtime);
    }
  , statusUptime: function () {
      return msToHumanReadable(this.status.uptime);
    }
  }
, methods: appMethods
});

function run(key) {
  // 1. Get ACME directory
  // 2. Fetch ACME account
  // 3. Test if account has access
  // 4. Show command line auth instructions to auth
  // 5. Sign requests / use JWT
  // 6. Enforce token required for config, status, etc
  // 7. Move admin interface to standard ports (admin.foo-bar-123.telebit.xyz)
  api.config().then(function (config) {
    telebitState.config = config;
    if (config.greenlock) {
      appData.init.acmeServer = config.greenlock.server;
    }
    if (config.relay) {
      appData.init.relay = config.relay;
    }
    if (config.email) {
      appData.init.email = config.email;
    }
    if (config.agreeTos) {
      appData.init.letos = config.agreeTos;
      appData.init.teletos = config.agreeTos;
    }
    if (config._otp) {
      appData.init.otp = config._otp;
    }

    telebitState.pollUrl = config._pollUrl || localStorage.getItem('poll_url');

    if ((!config.token && !config._otp) || !config.relay || !config.email || !config.agreeTos) {
      changeState('setup');
      setState();
      return;
    }
    if (!config.token && config._otp) {
      changeState('otp');
      setState();
      // this will skip ahead as necessary
      return Telebit.authorize(telebitState, showOtp).then(function () {
        return changeState('status');
      });
    }

    // TODO handle default state
    changeState('status');
  }).catch(function (err) {
    appData.views.flash.error = err.message || JSON.stringify(err, null, 2);
  });
}


// TODO protect key with passphrase (or QR code?)
function getKey() {
  var key;
  try {
    key = JSON.parse(localStorage.getItem('key'));
  } catch(e) {
    // ignore
  }
  if (key && key.kid && key.d) {
    return Promise.resolve(key);
  }
  return Keypairs.generate().then(function (pair) {
    key = pair.private;
    localStorage.setItem('key', JSON.stringify(key));
    return key;
  });
}

window.api = api;
getKey().then(function (key) {
  run(key);
  setTimeout(function () {
    document.body.hidden = false;
  }, 50);
});

}());

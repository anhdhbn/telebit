;(function () {
'use strict';

var Vue = window.Vue;
var Telebit = window.TELEBIT;
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
api.initialize = function apiInitialize() {
  var opts = {
    url: "/api/xxinitxx"
  , method: "POST"
  , headers: {
      'Content-Type': 'application/json'
    }
  , body: JSON.stringify(telebitState.config)
  };
  return Telebit.reqLocalAsync(opts).then(function (resp) {
    var json = resp.body;
    appData.initResult = json;
    window.alert("Error: [success] " + JSON.stringify(json, null, 2));
    return json;
  }).catch(function (err) {
    window.alert("Error: [init] " + (err.message || JSON.stringify(err, null, 2)));
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
    console.log('1 api.init...');
    return api.initialize();
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
  config: null
, status: null
, init: {
    teletos: true
  , letos: true
  , notifications: "important"
  , relay: DEFAULT_RELAY
  , telemetry: true
  , acmeServer: PRODUCTION_ACME
  }
, http: null
, tcp: null
, ssh: null
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
, defaultRhubarb: function () {
    appData.init.rhubarb = DEFAULT_RELAY;
  }
, betaRhubarb: function () {
    appData.init.rhubarb = BETA_RELAY;
  }
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
    appData.views.section = { status: true };
    return api.status().then(function (status) {
      appData.status = status;
    });
  }
};

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
window.addEventListener('hashchange', setState, false);
function setState(/*ev*/) {
  //ev.oldURL
  //ev.newURL
  var parts = location.hash.substr(1).replace(/^\//, '').replace(/\/$/, '').split('/');
  var fn = appStates;
  parts.forEach(function (s) {
    console.log("state:", s);
    fn = fn[s];
  });
  fn();
  //appMethods.states[newstate]();
}

new Vue({
  el: ".v-app"
, data: appData
, methods: appMethods
});


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
      console.log('2 api.init...');
      return api.initialize();
    });
  }

  // TODO handle default state
  changeState('status');
}).catch(function (err) {
  appData.views.flash.error = err.message || JSON.stringify(err, null, 2);
});

window.api = api;

setTimeout(function () {
  document.body.hidden = false;
}, 50);

}());

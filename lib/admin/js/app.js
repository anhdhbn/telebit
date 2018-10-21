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
    appData.status = json;
    return json;
  });
};
api.initialize = function apiInitialize() {
  var opts = {
    url: "/api/init"
  , method: "POST"
  , headers: {
      'Content-Type': 'application/json'
    }
  , body: JSON.stringify({
      foo: 'bar'
    })
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
    section: {
      setup: false
    , advanced: false
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
      if (-1 !== TELEBIT_RELAYS.indexOf(appData.init.relay)) {
        if (!telebitState.config) { telebitState.config = {}; }
        if (!telebitState.config.relay) { telebitState.config.relay = telebitState.relay; }
        telebitState.config.email = appData.init.email;
        telebitState.config._otp = Telebit.otp();
        return Telebit.authorize(telebitState).then(function () {
          console.log('1 api.init...');
          return api.initialize();
        }).catch(function (err) {
          console.error(err);
          window.alert("Error: [authorize] " + (err.message || JSON.stringify(err, null, 2)));
        });
      } else {
        changeState('advanced');
      }
    }).catch(function (err) {
      console.error(err);
      window.alert("Error: [directory] " + (err.message || JSON.stringify(err, null, 2)));
    });
  }
, advance: function () {
    console.log('2 api.init...');
    return api.initialize();
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
};

function changeState(newstate) {
  location.hash = '#/' + newstate + '/';
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


api.config();
api.status().then(function () {
  changeState('setup');
  setState();
});

window.api = api;
}());

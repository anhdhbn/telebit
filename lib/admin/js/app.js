;(function () {
'use strict';

console.log("hello");

var Vue = window.Vue;
var api = {};

api.config = function apiConfig() {
  return window.fetch("/api/config", { method: "GET" }).then(function (resp) {
    return resp.json().then(function (json) {
      appData.config = json;
      return json;
    });
  });
};
api.status = function apiStatus() {
  return window.fetch("/api/status", { method: "GET" }).then(function (resp) {
    return resp.json().then(function (json) {
      appData.status = json;
      return json;
    });
  });
};

// TODO test for internet connectivity (and telebit connectivity)
var DEFAULT_RELAY = 'telebit.cloud';
var BETA_RELAY = 'telebit.ppl.family';
var appData = {
  config: null
, status: null
, init: {
    teletos: true
  , letos: true
  , notifications: "important"
  , relay: DEFAULT_RELAY
  }
, http: null
, tcp: null
, ssh: null
, views: {
    section: {
      create: true
    }
  }
};
var appMethods = {
  initialize: function () {
    console.log("call initialize");
    if (!appData.init.relay) {
      appData.init.relay = DEFAULT_RELAY;
    }
    if (DEFAULT_RELAY !== appData.init.relay) {
      window.alert("TODO: Custom Relay Not Implemented Yet");
    }
  }
, defaultRelay: function () {
    appData.init.relay = DEFAULT_RELAY;
  }
, betaRelay: function () {
    appData.init.relay = BETA_RELAY;
  }
};

new Vue({
  el: ".v-app"
, data: appData
, methods: appMethods
});

api.config();
api.status();

window.api = api;
}());

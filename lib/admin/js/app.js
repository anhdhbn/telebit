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

var appData = {
  config: null
, status: null
, init: {}
, http: null
, tcp: null
, ssh: null
};
var appMethods = {
  initialize: function () {
    console.log("call initialize");
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

(function () {
'use strict';

document.body.hidden = false;

var hash = window.location.hash.substr(1);
var query = window.location.search;

function parseQuery(search) {
    var args = search.substring(1).split('&');
    var argsParsed = {};
    var i, arg, kvp, key, value;

    for (i=0; i < args.length; i++) {

        arg = args[i];

        if (-1 === arg.indexOf('=')) {

            argsParsed[decodeURIComponent(arg).trim()] = true;

        } else {

            kvp = arg.split('=');
            key = decodeURIComponent(kvp[0]).trim();
            value = decodeURIComponent(kvp[1]).trim();
            argsParsed[key] = value;

        }
    }

    return argsParsed;
}

document.querySelectorAll('.js-servername').forEach(function ($el) {
  $el.innerText = window.location.host;
});

console.log(parseQuery(hash));
console.log(parseQuery(query));
var port = parseQuery(hash).serviceport || parseQuery(query).serviceport;
if (port) {
  document.querySelector('.js-port').hidden = false;
  document.querySelectorAll('.js-serviceport').forEach(function ($el) {
    $el.innerText = port;
  });
}

}());

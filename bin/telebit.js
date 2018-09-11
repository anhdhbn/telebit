#!/usr/bin/env node
(function () {
'use strict';

// node telebit daemon arg1 arg2
if ('daemon' === process.argv[2]) {
  require('./telebitd.js');
} else if ('sclient' === process.argv[2]) {
  process.argv.splice(1,1);
  require('sclient/bin/sclient.js');
} else if ('ssh' === process.argv[2] && /[\w-]+\.[a-z]{2,}/i.test(process.argv[3])) {
  process.argv.splice(1,1,'sclient');
  process.argv.splice(2,1,'--ssh');
  require('sclient/bin/sclient.js');
} else {
  require('./telebit-remote.js');
}

}());

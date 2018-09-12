#!/usr/bin/env node
(function () {
'use strict';

// node telebit daemon arg1 arg2
if ('daemon' === process.argv[2]) {
  require('./telebitd.js');
} else {
  require('./telebit-remote.js');
}

}());

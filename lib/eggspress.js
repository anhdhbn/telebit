'use strict';

module.exports = function eggspress() {
  //var patternsMap = {};
  var allPatterns = [];
  var app = function (req, res) {
    var patterns = allPatterns.slice(0).reverse();
    function next() {
      var todo = patterns.pop();
      if (!todo) {
        console.log('[eggspress] Did not match any patterns', req.url);
        require('finalhandler')(req, res)();
        return;
      }

      // '', GET, POST, DELETE
      if (todo[2] && req.method.toLowerCase() !== todo[2]) {
        //console.log("[eggspress] HTTP method doesn't match", req.url);
        next();
        return;
      }

      if (!req.url.match(todo[0])) {
        //console.log("[eggspress] pattern doesn't match", todo[0], req.url);
        next();
        return;
      } else if ('string' === typeof todo[0] && 0 !== req.url.match(todo[0]).index) {
        //console.log("[eggspress] string pattern is not the start", todo[0], req.url);
        next();
        return;
      }

      try {
        //console.log("[eggspress] matched pattern", todo[0], req.url);
        todo[1](req, res, next);
      } catch(e) {
        console.error("[eggspress] error", todo[2], todo[0], req.url);
        console.error(e);
        // TODO make a nice error message
        res.end(e.message);
        return;
      }
    }
    next();
  };

  app.use = function (pattern, fn) {
    return app._use('', pattern, fn);
  };
  [ 'GET', 'POST', 'DELETE' ].forEach(function (method) {
    app[method.toLowerCase()] = function (pattern, fn) {
      return app._use(method, pattern, fn);
    };
  });

  app.post = function (pattern, fn) {
    return app._use('POST', pattern, fn);
  };
  app._use = function (method, pattern, fn) {
    // always end in a slash, for now
    if ('string' === typeof pattern) {
      pattern = pattern.replace(/\/$/, '')  + '/';
    }
    /*
    if (!patternsMap[pattern]) {
      patternsMap[pattern] = [];
    }
    patternsMap[pattern].push(fn);
    patterns = Object.keys(patternsMap).sort(function (a, b) {
      return b.length - a.length;
    });
    */
    allPatterns.push([pattern, fn, method.toLowerCase()]);
    return app;
  };

  return app;
};

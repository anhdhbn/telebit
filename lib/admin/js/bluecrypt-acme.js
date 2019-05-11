// Copyright 2015-2019 AJ ONeal. All rights reserved
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
;
(function (exports) {

var Enc = exports.Enc = {};

Enc.bufToBin = function (buf) {
  var bin = '';
  // cannot use .map() because Uint8Array would return only 0s
  buf.forEach(function (ch) {
    bin += String.fromCharCode(ch);
  });
  return bin;
};

Enc.bufToHex = function toHex(u8) {
  var hex = [];
  var i, h;
  var len = (u8.byteLength || u8.length);

  for (i = 0; i < len; i += 1) {
    h = u8[i].toString(16);
    if (h.length % 2) { h = '0' + h; }
    hex.push(h);
  }

  return hex.join('').toLowerCase();
};

Enc.urlBase64ToBase64 = function urlsafeBase64ToBase64(str) {
  var r = str % 4;
  if (2 === r) {
    str += '==';
  } else if (3 === r) {
    str += '=';
  }
  return str.replace(/-/g, '+').replace(/_/g, '/');
};

Enc.base64ToBuf = function (b64) {
  return Enc.binToBuf(atob(b64));
};
Enc.binToBuf = function (bin) {
  var arr = bin.split('').map(function (ch) {
    return ch.charCodeAt(0);
  });
  return 'undefined' !== typeof Uint8Array ? new Uint8Array(arr) : arr;
};
Enc.bufToHex = function (u8) {
  var hex = [];
  var i, h;
  var len = (u8.byteLength || u8.length);

  for (i = 0; i < len; i += 1) {
    h = u8[i].toString(16);
    if (h.length % 2) { h = '0' + h; }
    hex.push(h);
  }

  return hex.join('').toLowerCase();
};
Enc.numToHex = function (d) {
  d = d.toString(16);
  if (d.length % 2) {
    return '0' + d;
  }
  return d;
};

Enc.bufToUrlBase64 = function (u8) {
  return Enc.base64ToUrlBase64(Enc.bufToBase64(u8));
};

Enc.base64ToUrlBase64 = function (str) {
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

Enc.bufToBase64 = function (u8) {
  var bin = '';
  u8.forEach(function (i) {
    bin += String.fromCharCode(i);
  });
  return btoa(bin);
};

Enc.hexToBuf = function (hex) {
  var arr = [];
  hex.match(/.{2}/g).forEach(function (h) {
    arr.push(parseInt(h, 16));
  });
  return 'undefined' !== typeof Uint8Array ? new Uint8Array(arr) : arr;
};

Enc.numToHex = function (d) {
  d = d.toString(16);
  if (d.length % 2) {
    return '0' + d;
  }
  return d;
};


//
// JWK to SSH (tested working)
//
Enc.base64ToHex = function (b64) {
  var bin = atob(Enc.urlBase64ToBase64(b64));
  return Enc.binToHex(bin);
};

Enc.binToHex = function (bin) {
  return bin.split('').map(function (ch) {
    var h = ch.charCodeAt(0).toString(16);
    if (h.length % 2) { h = '0' + h; }
    return h;
  }).join('');
};
// TODO are there any nuance differences here?
Enc.utf8ToHex = Enc.binToHex;

Enc.hexToBase64 = function (hex) {
  return btoa(Enc.hexToBin(hex));
};

Enc.hexToBin = function (hex) {
  return hex.match(/.{2}/g).map(function (h) {
    return String.fromCharCode(parseInt(h, 16));
  }).join('');
};

Enc.urlBase64ToBase64 = function urlsafeBase64ToBase64(str) {
  var r = str % 4;
  if (2 === r) {
    str += '==';
  } else if (3 === r) {
    str += '=';
  }
  return str.replace(/-/g, '+').replace(/_/g, '/');
};


}('undefined' !== typeof exports ? module.exports : window ));
;(function (exports) {
'use strict';

if (!exports.ASN1) { exports.ASN1 = {}; }
if (!exports.Enc) { exports.Enc = {}; }
if (!exports.PEM) { exports.PEM = {}; }

var ASN1 = exports.ASN1;
var Enc = exports.Enc;
var PEM = exports.PEM;

//
// Packer
//

// Almost every ASN.1 type that's important for CSR
// can be represented generically with only a few rules.
exports.ASN1 = function ASN1(/*type, hexstrings...*/) {
  var args = Array.prototype.slice.call(arguments);
  var typ = args.shift();
  var str = args.join('').replace(/\s+/g, '').toLowerCase();
  var len = (str.length/2);
  var lenlen = 0;
  var hex = typ;

  // We can't have an odd number of hex chars
  if (len !== Math.round(len)) {
    throw new Error("invalid hex");
  }

  // The first byte of any ASN.1 sequence is the type (Sequence, Integer, etc)
  // The second byte is either the size of the value, or the size of its size

  // 1. If the second byte is < 0x80 (128) it is considered the size
  // 2. If it is > 0x80 then it describes the number of bytes of the size
  //    ex: 0x82 means the next 2 bytes describe the size of the value
  // 3. The special case of exactly 0x80 is "indefinite" length (to end-of-file)

  if (len > 127) {
    lenlen += 1;
    while (len > 255) {
      lenlen += 1;
      len = len >> 8;
    }
  }

  if (lenlen) { hex += Enc.numToHex(0x80 + lenlen); }
  return hex + Enc.numToHex(str.length/2) + str;
};

// The Integer type has some special rules
ASN1.UInt = function UINT() {
  var str = Array.prototype.slice.call(arguments).join('');
  var first = parseInt(str.slice(0, 2), 16);

  // If the first byte is 0x80 or greater, the number is considered negative
  // Therefore we add a '00' prefix if the 0x80 bit is set
  if (0x80 & first) { str = '00' + str; }

  return ASN1('02', str);
};

// The Bit String type also has a special rule
ASN1.BitStr = function BITSTR() {
  var str = Array.prototype.slice.call(arguments).join('');
  // '00' is a mask of how many bits of the next byte to ignore
  return ASN1('03', '00' + str);
};

ASN1.pack = function (arr) {
  var typ = Enc.numToHex(arr[0]);
  var str = '';
  if (Array.isArray(arr[1])) {
    arr[1].forEach(function (a) {
      str += ASN1.pack(a);
    });
  } else if ('string' === typeof arr[1]) {
    str = arr[1];
  } else {
    throw new Error("unexpected array");
  }
  if ('03' === typ) {
    return ASN1.BitStr(str);
  } else if ('02' === typ) {
    return ASN1.UInt(str);
  } else {
    return ASN1(typ, str);
  }
};
Object.keys(ASN1).forEach(function (k) {
  exports.ASN1[k] = ASN1[k];
});
ASN1 = exports.ASN1;

PEM.packBlock = function (opts) {
  // TODO allow for headers?
  return '-----BEGIN ' + opts.type + '-----\n'
    + Enc.bufToBase64(opts.bytes).match(/.{1,64}/g).join('\n') + '\n'
    + '-----END ' + opts.type + '-----'
  ;
};

Enc.bufToBase64 = function (u8) {
  var bin = '';
  u8.forEach(function (i) {
    bin += String.fromCharCode(i);
  });
  return btoa(bin);
};

Enc.hexToBuf = function (hex) {
  var arr = [];
  hex.match(/.{2}/g).forEach(function (h) {
    arr.push(parseInt(h, 16));
  });
  return 'undefined' !== typeof Uint8Array ? new Uint8Array(arr) : arr;
};

Enc.numToHex = function (d) {
  d = d.toString(16);
  if (d.length % 2) {
    return '0' + d;
  }
  return d;
};

}('undefined' !== typeof window ? window : module.exports));
(function (exports) {
  'use strict';

  var x509 = exports.x509 = {};
  var ASN1 = exports.ASN1;
  var Enc = exports.Enc;

  // 1.2.840.10045.3.1.7
  // prime256v1 (ANSI X9.62 named elliptic curve)
  var OBJ_ID_EC = '06 08 2A8648CE3D030107'.replace(/\s+/g, '').toLowerCase();
  // 1.3.132.0.34
  // secp384r1 (SECG (Certicom) named elliptic curve)
  var OBJ_ID_EC_384 = '06 05 2B81040022'.replace(/\s+/g, '').toLowerCase();
  // 1.2.840.10045.2.1
  // ecPublicKey (ANSI X9.62 public key type)
  var OBJ_ID_EC_PUB = '06 07 2A8648CE3D0201'.replace(/\s+/g, '').toLowerCase();

  x509.parseSec1 = function parseEcOnlyPrivkey(u8, jwk) {
    var index = 7;
    var len = 32;
    var olen = OBJ_ID_EC.length / 2;

    if ("P-384" === jwk.crv) {
      olen = OBJ_ID_EC_384.length / 2;
      index = 8;
      len = 48;
    }
    if (len !== u8[index - 1]) {
      throw new Error("Unexpected bitlength " + len);
    }

    // private part is d
    var d = u8.slice(index, index + len);
    // compression bit index
    var ci = index + len + 2 + olen + 2 + 3;
    var c = u8[ci];
    var x, y;

    if (0x04 === c) {
      y = u8.slice(ci + 1 + len, ci + 1 + len + len);
    } else if (0x02 !== c) {
      throw new Error("not a supported EC private key");
    }
    x = u8.slice(ci + 1, ci + 1 + len);

    return {
      kty: jwk.kty
      , crv: jwk.crv
      , d: Enc.bufToUrlBase64(d)
      //, dh: Enc.bufToHex(d)
      , x: Enc.bufToUrlBase64(x)
      //, xh: Enc.bufToHex(x)
      , y: Enc.bufToUrlBase64(y)
      //, yh: Enc.bufToHex(y)
    };
  };

  x509.packPkcs1 = function (jwk) {
    var n = ASN1.UInt(Enc.base64ToHex(jwk.n));
    var e = ASN1.UInt(Enc.base64ToHex(jwk.e));

    if (!jwk.d) {
      return Enc.hexToBuf(ASN1('30', n, e));
    }

    return Enc.hexToBuf(ASN1('30'
    , ASN1.UInt('00')
    , n
    , e
    , ASN1.UInt(Enc.base64ToHex(jwk.d))
    , ASN1.UInt(Enc.base64ToHex(jwk.p))
    , ASN1.UInt(Enc.base64ToHex(jwk.q))
    , ASN1.UInt(Enc.base64ToHex(jwk.dp))
    , ASN1.UInt(Enc.base64ToHex(jwk.dq))
    , ASN1.UInt(Enc.base64ToHex(jwk.qi))
    ));
  };

  x509.parsePkcs8 = function parseEcPkcs8(u8, jwk) {
    var index = 24 + (OBJ_ID_EC.length / 2);
    var len = 32;
    if ("P-384" === jwk.crv) {
      index = 24 + (OBJ_ID_EC_384.length / 2) + 2;
      len = 48;
    }

    //console.log(index, u8.slice(index));
    if (0x04 !== u8[index]) {
      //console.log(jwk);
      throw new Error("privkey not found");
    }
    var d = u8.slice(index + 2, index + 2 + len);
    var ci = index + 2 + len + 5;
    var xi = ci + 1;
    var x = u8.slice(xi, xi + len);
    var yi = xi + len;
    var y;
    if (0x04 === u8[ci]) {
      y = u8.slice(yi, yi + len);
    } else if (0x02 !== u8[ci]) {
      throw new Error("invalid compression bit (expected 0x04 or 0x02)");
    }

    return {
      kty: jwk.kty
      , crv: jwk.crv
      , d: Enc.bufToUrlBase64(d)
      //, dh: Enc.bufToHex(d)
      , x: Enc.bufToUrlBase64(x)
      //, xh: Enc.bufToHex(x)
      , y: Enc.bufToUrlBase64(y)
      //, yh: Enc.bufToHex(y)
    };
  };

  x509.parseSpki = function parsePem(u8, jwk) {
    var ci = 16 + OBJ_ID_EC.length / 2;
    var len = 32;

    if ("P-384" === jwk.crv) {
      ci = 16 + OBJ_ID_EC_384.length / 2;
      len = 48;
    }

    var c = u8[ci];
    var xi = ci + 1;
    var x = u8.slice(xi, xi + len);
    var yi = xi + len;
    var y;
    if (0x04 === c) {
      y = u8.slice(yi, yi + len);
    } else if (0x02 !== c) {
      throw new Error("not a supported EC private key");
    }

    return {
      kty: jwk.kty
      , crv: jwk.crv
      , x: Enc.bufToUrlBase64(x)
      //, xh: Enc.bufToHex(x)
      , y: Enc.bufToUrlBase64(y)
      //, yh: Enc.bufToHex(y)
    };
  };
  x509.parsePkix = x509.parseSpki;

  x509.packSec1 = function (jwk) {
    var d = Enc.base64ToHex(jwk.d);
    var x = Enc.base64ToHex(jwk.x);
    var y = Enc.base64ToHex(jwk.y);
    var objId = ('P-256' === jwk.crv) ? OBJ_ID_EC : OBJ_ID_EC_384;
    return Enc.hexToBuf(
      ASN1('30'
        , ASN1.UInt('01')
        , ASN1('04', d)
        , ASN1('A0', objId)
        , ASN1('A1', ASN1.BitStr('04' + x + y)))
    );
  };
  /**
   * take a private jwk and creates a der from it
   * @param {*} jwk
   */
  x509.packPkcs8 = function (jwk) {
    if ('RSA' === jwk.kty) {
      if (!jwk.d) {
        // Public RSA
        return Enc.hexToBuf(ASN1('30'
          , ASN1('30'
            , ASN1('06', '2a864886f70d010101')
            , ASN1('05')
          )
          , ASN1.BitStr(ASN1('30'
            , ASN1.UInt(Enc.base64ToHex(jwk.n))
            , ASN1.UInt(Enc.base64ToHex(jwk.e))
          ))
        ));
      }

      // Private RSA
      return Enc.hexToBuf(ASN1('30'
        , ASN1.UInt('00')
        , ASN1('30'
          , ASN1('06', '2a864886f70d010101')
          , ASN1('05')
        )
        , ASN1('04'
          , ASN1('30'
            , ASN1.UInt('00')
            , ASN1.UInt(Enc.base64ToHex(jwk.n))
            , ASN1.UInt(Enc.base64ToHex(jwk.e))
            , ASN1.UInt(Enc.base64ToHex(jwk.d))
            , ASN1.UInt(Enc.base64ToHex(jwk.p))
            , ASN1.UInt(Enc.base64ToHex(jwk.q))
            , ASN1.UInt(Enc.base64ToHex(jwk.dp))
            , ASN1.UInt(Enc.base64ToHex(jwk.dq))
            , ASN1.UInt(Enc.base64ToHex(jwk.qi))
          )
        )
      ));
    }

    var d = Enc.base64ToHex(jwk.d);
    var x = Enc.base64ToHex(jwk.x);
    var y = Enc.base64ToHex(jwk.y);
    var objId = ('P-256' === jwk.crv) ? OBJ_ID_EC : OBJ_ID_EC_384;
    return Enc.hexToBuf(
      ASN1('30'
        , ASN1.UInt('00')
        , ASN1('30'
          , OBJ_ID_EC_PUB
          , objId
        )
        , ASN1('04'
          , ASN1('30'
            , ASN1.UInt('01')
            , ASN1('04', d)
            , ASN1('A1', ASN1.BitStr('04' + x + y)))))
    );
  };
  x509.packSpki = function (jwk) {
    if (/EC/i.test(jwk.kty)) {
      return x509.packSpkiEc(jwk);
    }
    return x509.packSpkiRsa(jwk);
  };
  x509.packSpkiRsa = function (jwk) {
  if (!jwk.d) {
    // Public RSA
    return Enc.hexToBuf(ASN1('30'
      , ASN1('30'
        , ASN1('06', '2a864886f70d010101')
        , ASN1('05')
      )
      , ASN1.BitStr(ASN1('30'
        , ASN1.UInt(Enc.base64ToHex(jwk.n))
        , ASN1.UInt(Enc.base64ToHex(jwk.e))
      ))
    ));
  }

  // Private RSA
  return Enc.hexToBuf(ASN1('30'
    , ASN1.UInt('00')
    , ASN1('30'
      , ASN1('06', '2a864886f70d010101')
      , ASN1('05')
    )
    , ASN1('04'
      , ASN1('30'
        , ASN1.UInt('00')
        , ASN1.UInt(Enc.base64ToHex(jwk.n))
        , ASN1.UInt(Enc.base64ToHex(jwk.e))
        , ASN1.UInt(Enc.base64ToHex(jwk.d))
        , ASN1.UInt(Enc.base64ToHex(jwk.p))
        , ASN1.UInt(Enc.base64ToHex(jwk.q))
        , ASN1.UInt(Enc.base64ToHex(jwk.dp))
        , ASN1.UInt(Enc.base64ToHex(jwk.dq))
        , ASN1.UInt(Enc.base64ToHex(jwk.qi))
      )
    )
  ));
};
  x509.packSpkiEc = function (jwk) {
    var x = Enc.base64ToHex(jwk.x);
    var y = Enc.base64ToHex(jwk.y);
    var objId = ('P-256' === jwk.crv) ? OBJ_ID_EC : OBJ_ID_EC_384;
    return Enc.hexToBuf(
      ASN1('30'
        , ASN1('30'
          , OBJ_ID_EC_PUB
          , objId
        )
        , ASN1.BitStr('04' + x + y))
    );
  };
  x509.packPkix = x509.packSpki;

}('undefined' !== typeof module ? module.exports : window));
/*global Promise*/
(function (exports) {
'use strict';

var EC = exports.Eckles = {};
var x509 = exports.x509;
if ('undefined' !== typeof module) { module.exports = EC; }
var PEM = exports.PEM;
var SSH = exports.SSH;
var Enc = {};
var textEncoder = new TextEncoder();

EC._stance = "We take the stance that if you're knowledgeable enough to"
  + " properly and securely use non-standard crypto then you shouldn't need Bluecrypt anyway.";
EC._universal = "Bluecrypt only supports crypto with standard cross-browser and cross-platform support.";
EC.generate = function (opts) {
  var wcOpts = {};
  if (!opts) { opts = {}; }
  if (!opts.kty) { opts.kty = 'EC'; }

  // ECDSA has only the P curves and an associated bitlength
  wcOpts.name = 'ECDSA';
  if (!opts.namedCurve) {
    opts.namedCurve = 'P-256';
  }
  wcOpts.namedCurve = opts.namedCurve; // true for supported curves
  if (/256/.test(wcOpts.namedCurve)) {
    wcOpts.namedCurve = 'P-256';
    wcOpts.hash = { name: "SHA-256" };
  } else if (/384/.test(wcOpts.namedCurve)) {
    wcOpts.namedCurve = 'P-384';
    wcOpts.hash = { name: "SHA-384" };
  } else {
    return Promise.Reject(new Error("'" + wcOpts.namedCurve + "' is not an NIST approved ECDSA namedCurve. "
      + " Please choose either 'P-256' or 'P-384'. "
      + EC._stance));
  }

  var extractable = true;
  return window.crypto.subtle.generateKey(
    wcOpts
  , extractable
  , [ 'sign', 'verify' ]
  ).then(function (result) {
    return window.crypto.subtle.exportKey(
      "jwk"
    , result.privateKey
    ).then(function (privJwk) {
      privJwk.key_ops = undefined;
      privJwk.ext = undefined;
      return {
        private: privJwk
      , public: EC.neuter({ jwk: privJwk })
      };
    });
  });
};

EC.export = function (opts) {
  return Promise.resolve().then(function () {
    if (!opts || !opts.jwk || 'object' !== typeof opts.jwk) {
      throw new Error("must pass { jwk: jwk } as a JSON object");
    }
    var jwk = JSON.parse(JSON.stringify(opts.jwk));
    var format = opts.format;
    if (opts.public || -1 !== [ 'spki', 'pkix', 'ssh', 'rfc4716' ].indexOf(format)) {
      jwk.d = null;
    }
    if ('EC' !== jwk.kty) {
      throw new Error("options.jwk.kty must be 'EC' for EC keys");
    }
    if (!jwk.d) {
      if (!format || -1 !== [ 'spki', 'pkix' ].indexOf(format)) {
        format = 'spki';
      } else if (-1 !== [ 'ssh', 'rfc4716' ].indexOf(format)) {
        format = 'ssh';
      } else {
        throw new Error("options.format must be 'spki' or 'ssh' for public EC keys, not ("
          + typeof format + ") " + format);
      }
    } else {
      if (!format || 'sec1' === format) {
        format = 'sec1';
      } else if ('pkcs8' !== format) {
        throw new Error("options.format must be 'sec1' or 'pkcs8' for private EC keys, not '" + format + "'");
      }
    }
    if (-1 === [ 'P-256', 'P-384' ].indexOf(jwk.crv)) {
      throw new Error("options.jwk.crv must be either P-256 or P-384 for EC keys, not '" + jwk.crv + "'");
    }
    if (!jwk.y) {
      throw new Error("options.jwk.y must be a urlsafe base64-encoded either P-256 or P-384");
    }

    if ('sec1' === format) {
      return PEM.packBlock({ type: "EC PRIVATE KEY", bytes: x509.packSec1(jwk) });
    } else if ('pkcs8' === format) {
      return PEM.packBlock({ type: "PRIVATE KEY", bytes: x509.packPkcs8(jwk) });
    } else if (-1 !== [ 'spki', 'pkix' ].indexOf(format)) {
      return PEM.packBlock({ type: "PUBLIC KEY", bytes: x509.packSpki(jwk) });
    } else if (-1 !== [ 'ssh', 'rfc4716' ].indexOf(format)) {
      return SSH.packSsh(jwk);
    } else {
      throw new Error("Sanity Error: reached unreachable code block with format: " + format);
    }
  });
};
EC.pack = function (opts) {
  return Promise.resolve().then(function () {
    return EC.exportSync(opts);
  });
};

// Chopping off the private parts is now part of the public API.
// I thought it sounded a little too crude at first, but it really is the best name in every possible way.
EC.neuter = function (opts) {
  // trying to find the best balance of an immutable copy with custom attributes
  var jwk = {};
  Object.keys(opts.jwk).forEach(function (k) {
    if ('undefined' === typeof opts.jwk[k]) { return; }
    // ignore EC private parts
    if ('d' === k) { return; }
    jwk[k] = JSON.parse(JSON.stringify(opts.jwk[k]));
  });
  return jwk;
};

// https://stackoverflow.com/questions/42588786/how-to-fingerprint-a-jwk
EC.__thumbprint = function (jwk) {
  // Use the same entropy for SHA as for key
  var alg = 'SHA-256';
  if (/384/.test(jwk.crv)) {
    alg = 'SHA-384';
  }
  return window.crypto.subtle.digest(
    { name: alg }
  , textEncoder.encode('{"crv":"' + jwk.crv + '","kty":"EC","x":"' + jwk.x + '","y":"' + jwk.y + '"}')
  ).then(function (hash) {
    return Enc.bufToUrlBase64(new Uint8Array(hash));
  });
};

EC.thumbprint = function (opts) {
  return Promise.resolve().then(function () {
    var jwk;
    if ('EC' === opts.kty) {
      jwk = opts;
    } else if (opts.jwk) {
      jwk = opts.jwk;
    } else {
      return EC.import(opts).then(function (jwk) {
        return EC.__thumbprint(jwk);
      });
    }
    return EC.__thumbprint(jwk);
  });
};

Enc.bufToUrlBase64 = function (u8) {
  return Enc.bufToBase64(u8)
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

Enc.bufToBase64 = function (u8) {
  var bin = '';
  u8.forEach(function (i) {
    bin += String.fromCharCode(i);
  });
  return btoa(bin);
};

}('undefined' !== typeof module ? module.exports : window));
/*global Promise*/
(function (exports) {
'use strict';

var RSA = exports.Rasha = {};
var x509 = exports.x509;
if ('undefined' !== typeof module) { module.exports = RSA; }
var PEM = exports.PEM;
var SSH = exports.SSH;
var Enc = {};
var textEncoder = new TextEncoder();

RSA._stance = "We take the stance that if you're knowledgeable enough to"
  + " properly and securely use non-standard crypto then you shouldn't need Bluecrypt anyway.";
RSA._universal = "Bluecrypt only supports crypto with standard cross-browser and cross-platform support.";
RSA.generate = function (opts) {
  var wcOpts = {};
  if (!opts) { opts = {}; }
  if (!opts.kty) { opts.kty = 'RSA'; }

  // Support PSS? I don't think it's used for Let's Encrypt
  wcOpts.name = 'RSASSA-PKCS1-v1_5';
  if (!opts.modulusLength) {
    opts.modulusLength = 2048;
  }
  wcOpts.modulusLength = opts.modulusLength;
  if (wcOpts.modulusLength >= 2048 && wcOpts.modulusLength < 3072) {
    // erring on the small side... for no good reason
    wcOpts.hash = { name: "SHA-256" };
  } else if (wcOpts.modulusLength >= 3072 && wcOpts.modulusLength < 4096) {
    wcOpts.hash = { name: "SHA-384" };
  } else if (wcOpts.modulusLength < 4097) {
    wcOpts.hash = { name: "SHA-512" };
  } else {
    // Public key thumbprints should be paired with a hash of similar length,
    // so anything above SHA-512's keyspace would be left under-represented anyway.
    return Promise.Reject(new Error("'" + wcOpts.modulusLength + "' is not within the safe and universally"
      + " acceptable range of 2048-4096. Typically you should pick 2048, 3072, or 4096, though other values"
      + " divisible by 8 are allowed. " + RSA._stance));
  }
  // TODO maybe allow this to be set to any of the standard values?
  wcOpts.publicExponent = new Uint8Array([0x01, 0x00, 0x01]);

  var extractable = true;
  return window.crypto.subtle.generateKey(
    wcOpts
  , extractable
  , [ 'sign', 'verify' ]
  ).then(function (result) {
    return window.crypto.subtle.exportKey(
      "jwk"
    , result.privateKey
    ).then(function (privJwk) {
      return {
        private: privJwk
      , public: RSA.neuter({ jwk: privJwk })
      };
    });
  });
};

// Chopping off the private parts is now part of the public API.
// I thought it sounded a little too crude at first, but it really is the best name in every possible way.
RSA.neuter = function (opts) {
  // trying to find the best balance of an immutable copy with custom attributes
  var jwk = {};
  Object.keys(opts.jwk).forEach(function (k) {
    if ('undefined' === typeof opts.jwk[k]) { return; }
    // ignore RSA private parts
    if (-1 !== ['d', 'p', 'q', 'dp', 'dq', 'qi'].indexOf(k)) { return; }
    jwk[k] = JSON.parse(JSON.stringify(opts.jwk[k]));
  });
  return jwk;
};

// https://stackoverflow.com/questions/42588786/how-to-fingerprint-a-jwk
RSA.__thumbprint = function (jwk) {
  // Use the same entropy for SHA as for key
  var len = Math.floor(jwk.n.length * 0.75);
  var alg = 'SHA-256';
  // TODO this may be a bug
  // need to confirm that the padding is no more or less than 1 byte
  if (len >= 511) {
    alg = 'SHA-512';
  } else if (len >= 383) {
    alg = 'SHA-384';
  }
  return window.crypto.subtle.digest(
    { name: alg }
  , textEncoder.encode('{"e":"' + jwk.e + '","kty":"RSA","n":"' + jwk.n + '"}')
  ).then(function (hash) {
    return Enc.bufToUrlBase64(new Uint8Array(hash));
  });
};

RSA.thumbprint = function (opts) {
  return Promise.resolve().then(function () {
    var jwk;
    if ('EC' === opts.kty) {
      jwk = opts;
    } else if (opts.jwk) {
      jwk = opts.jwk;
    } else {
      return RSA.import(opts).then(function (jwk) {
        return RSA.__thumbprint(jwk);
      });
    }
    return RSA.__thumbprint(jwk);
  });
};

RSA.export = function (opts) {
  return Promise.resolve().then(function () {
    if (!opts || !opts.jwk || 'object' !== typeof opts.jwk) {
      throw new Error("must pass { jwk: jwk }");
    }
    var jwk = JSON.parse(JSON.stringify(opts.jwk));
    var format = opts.format;
    var pub = opts.public;
    if (pub || -1 !== [ 'spki', 'pkix', 'ssh', 'rfc4716' ].indexOf(format)) {
      jwk = RSA.neuter({ jwk: jwk });
    }
    if ('RSA' !== jwk.kty) {
      throw new Error("options.jwk.kty must be 'RSA' for RSA keys");
    }
    if (!jwk.p) {
      // TODO test for n and e
      pub = true;
      if (!format || 'pkcs1' === format) {
        format = 'pkcs1';
      } else if (-1 !== [ 'spki', 'pkix' ].indexOf(format)) {
        format = 'spki';
      } else if (-1 !== [ 'ssh', 'rfc4716' ].indexOf(format)) {
        format = 'ssh';
      } else {
        throw new Error("options.format must be 'spki', 'pkcs1', or 'ssh' for public RSA keys, not ("
          + typeof format + ") " + format);
      }
    } else {
      // TODO test for all necessary keys (d, p, q ...)
      if (!format || 'pkcs1' === format) {
        format = 'pkcs1';
      } else if ('pkcs8' !== format) {
        throw new Error("options.format must be 'pkcs1' or 'pkcs8' for private RSA keys");
      }
    }

    if ('pkcs1' === format) {
      if (jwk.d) {
        return PEM.packBlock({ type: "RSA PRIVATE KEY", bytes: x509.packPkcs1(jwk) });
      } else {
        return PEM.packBlock({ type: "RSA PUBLIC KEY", bytes: x509.packPkcs1(jwk) });
      }
    } else if ('pkcs8' === format) {
      return PEM.packBlock({ type: "PRIVATE KEY", bytes: x509.packPkcs8(jwk) });
    } else if (-1 !== [ 'spki', 'pkix' ].indexOf(format)) {
      return PEM.packBlock({ type: "PUBLIC KEY", bytes: x509.packSpki(jwk) });
    } else if (-1 !== [ 'ssh', 'rfc4716' ].indexOf(format)) {
      return SSH.pack({ jwk: jwk, comment: opts.comment });
    } else {
      throw new Error("Sanity Error: reached unreachable code block with format: " + format);
    }
  });
};
RSA.pack = function (opts) {
  // wrapped in a promise for API compatibility
  // with the forthcoming browser version
  // (and potential future native node capability)
  return Promise.resolve().then(function () {
    return RSA.export(opts);
  });
};

Enc.bufToUrlBase64 = function (u8) {
  return Enc.bufToBase64(u8)
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

Enc.bufToBase64 = function (u8) {
  var bin = '';
  u8.forEach(function (i) {
    bin += String.fromCharCode(i);
  });
  return btoa(bin);
};

}('undefined' !== typeof module ? module.exports : window));
/*global Promise*/
(function (exports) {
'use strict';

var Keypairs = exports.Keypairs = {};
var Rasha = exports.Rasha;
var Eckles = exports.Eckles;
var Enc = exports.Enc || {};

Keypairs._stance = "We take the stance that if you're knowledgeable enough to"
  + " properly and securely use non-standard crypto then you shouldn't need Bluecrypt anyway.";
Keypairs._universal = "Bluecrypt only supports crypto with standard cross-browser and cross-platform support.";
Keypairs.generate = function (opts) {
  opts = opts || {};
  var p;
  if (!opts.kty) { opts.kty = opts.type; }
  if (!opts.kty) { opts.kty = 'EC'; }
  if (/^EC/i.test(opts.kty)) {
    p = Eckles.generate(opts);
  } else if (/^RSA$/i.test(opts.kty)) {
    p = Rasha.generate(opts);
  } else {
    return Promise.Reject(new Error("'" + opts.kty + "' is not a well-supported key type."
      + Keypairs._universal
      + " Please choose 'EC', or 'RSA' if you have good reason to."));
  }
  return p.then(function (pair) {
    return Keypairs.thumbprint({ jwk: pair.public }).then(function (thumb) {
      pair.private.kid = thumb; // maybe not the same id on the private key?
      pair.public.kid = thumb;
      return pair;
    });
  });
};

Keypairs.export = function (opts) {
  return Eckles.export(opts).catch(function (err) {
    return Rasha.export(opts).catch(function () {
      return Promise.reject(err);
    });
  });
};


/**
 * Chopping off the private parts is now part of the public API.
 * I thought it sounded a little too crude at first, but it really is the best name in every possible way.
 */
Keypairs.neuter = function (opts) {
  /** trying to find the best balance of an immutable copy with custom attributes */
  var jwk = {};
  Object.keys(opts.jwk).forEach(function (k) {
    if ('undefined' === typeof opts.jwk[k]) { return; }
    // ignore RSA and EC private parts
    if (-1 !== ['d', 'p', 'q', 'dp', 'dq', 'qi'].indexOf(k)) { return; }
    jwk[k] = JSON.parse(JSON.stringify(opts.jwk[k]));
  });
  return jwk;
};

Keypairs.thumbprint = function (opts) {
  return Promise.resolve().then(function () {
    if (/EC/i.test(opts.jwk.kty)) {
      return Eckles.thumbprint(opts);
    } else {
      return Rasha.thumbprint(opts);
    }
  });
};

Keypairs.publish = function (opts) {
  if ('object' !== typeof opts.jwk || !opts.jwk.kty) { throw new Error("invalid jwk: " + JSON.stringify(opts.jwk)); }

  /** returns a copy */
  var jwk = Keypairs.neuter(opts);

  if (jwk.exp) {
    jwk.exp = setTime(jwk.exp);
  } else {
    if (opts.exp) { jwk.exp = setTime(opts.exp); }
    else if (opts.expiresIn) { jwk.exp = Math.round(Date.now()/1000) + opts.expiresIn; }
    else if (opts.expiresAt) { jwk.exp = opts.expiresAt; }
  }
  if (!jwk.use && false !== jwk.use) { jwk.use = "sig"; }

  if (jwk.kid) { return Promise.resolve(jwk); }
  return Keypairs.thumbprint({ jwk: jwk }).then(function (thumb) { jwk.kid = thumb; return jwk; });
};

// JWT a.k.a. JWS with Claims using Compact Serialization
Keypairs.signJwt = function (opts) {
  return Keypairs.thumbprint({ jwk: opts.jwk }).then(function (thumb) {
    var header = opts.header || {};
    var claims = JSON.parse(JSON.stringify(opts.claims || {}));
    header.typ = 'JWT';

    if (!header.kid) { header.kid = thumb; }
    if (!header.alg && opts.alg) { header.alg = opts.alg; }
    if (!claims.iat && (false === claims.iat || false === opts.iat)) {
      claims.iat = undefined;
    } else if (!claims.iat) {
      claims.iat = Math.round(Date.now()/1000);
    }

    if (opts.exp) {
      claims.exp = setTime(opts.exp);
    } else if (!claims.exp && (false === claims.exp || false === opts.exp)) {
      claims.exp = undefined;
    } else if (!claims.exp) {
      throw new Error("opts.claims.exp should be the expiration date as seconds, human form (i.e. '1h' or '15m') or false");
    }

    if (opts.iss) { claims.iss = opts.iss; }
    if (!claims.iss && (false === claims.iss || false === opts.iss)) {
      claims.iss = undefined;
    } else if (!claims.iss) {
      throw new Error("opts.claims.iss should be in the form of https://example.com/, a secure OIDC base url");
    }

    return Keypairs.signJws({
      jwk: opts.jwk
    , pem: opts.pem
    , protected: header
    , header: undefined
    , payload: claims
    }).then(function (jws) {
      return [ jws.protected, jws.payload, jws.signature ].join('.');
    });
  });
};

Keypairs.signJws = function (opts) {
  return Keypairs.thumbprint(opts).then(function (thumb) {

    function alg() {
      if (!opts.jwk) {
        throw new Error("opts.jwk must exist and must declare 'typ'");
      }
      if (opts.jwk.alg) { return opts.jwk.alg; }
      var typ = ('RSA' === opts.jwk.kty) ? "RS" : "ES";
      return typ + Keypairs._getBits(opts);
    }

    function sign() {
      var protect = opts.protected;
      var payload = opts.payload;

      // Compute JWS signature
      var protectedHeader = "";
      // Because unprotected headers are allowed, regrettably...
      // https://stackoverflow.com/a/46288694
      if (false !== protect) {
        if (!protect) { protect = {}; }
        if (!protect.alg) { protect.alg = alg(); }
        // There's a particular request where ACME / Let's Encrypt explicitly doesn't use a kid
        if (false === protect.kid) { protect.kid = undefined; }
        else if (!protect.kid) { protect.kid = thumb; }
        protectedHeader = JSON.stringify(protect);
      }

      // Not sure how to handle the empty case since ACME POST-as-GET must be empty
      //if (!payload) {
      //  throw new Error("opts.payload should be JSON, string, or ArrayBuffer (it may be empty, but that must be explicit)");
      //}
      // Trying to detect if it's a plain object (not Buffer, ArrayBuffer, Array, Uint8Array, etc)
      if (payload && ('string' !== typeof payload)
        && ('undefined' === typeof payload.byteLength)
        && ('undefined' === typeof payload.buffer)
      ) {
        payload = JSON.stringify(payload);
      }
      // Converting to a buffer, even if it was just converted to a string
      if ('string' === typeof payload) {
        payload = Enc.binToBuf(payload);
      }

      // node specifies RSA-SHAxxx even when it's actually ecdsa (it's all encoded x509 shasums anyway)
      var protected64 = Enc.strToUrlBase64(protectedHeader);
      var payload64 = Enc.bufToUrlBase64(payload);
      var msg = protected64 + '.' + payload64;

      return Keypairs._sign(opts, msg).then(function (buf) {
        var signedMsg = {
          protected: protected64
        , payload: payload64
        , signature: Enc.bufToUrlBase64(buf)
        };

        return signedMsg;
      });
    }

    if (opts.jwk) {
      return sign();
    } else {
      return Keypairs.import({ pem: opts.pem }).then(function (pair) {
        opts.jwk = pair.private;
        return sign();
      });
    }
  });
};

Keypairs._sign = function (opts, payload) {
  return Keypairs._import(opts).then(function (privkey) {
    if ('string' === typeof payload) {
      payload = (new TextEncoder()).encode(payload);
    }
    return window.crypto.subtle.sign(
      { name: Keypairs._getName(opts)
      , hash: { name: 'SHA-' + Keypairs._getBits(opts) }
      }
    , privkey
    , payload
    ).then(function (signature) {
      signature = new Uint8Array(signature); // ArrayBuffer -> u8
      // This will come back into play for CSRs, but not for JOSE
      if ('EC' === opts.jwk.kty && /x509|asn1/i.test(opts.format)) {
        return Keypairs._ecdsaJoseSigToAsn1Sig(signature);
      } else {
        // jose/jws/jwt
        return signature;
      }
    });
  });
};
Keypairs._getBits = function (opts) {
  if (opts.alg) { return opts.alg.replace(/[a-z\-]/ig, ''); }
  // base64 len to byte len
  var len = Math.floor((opts.jwk.n||'').length * 0.75);

  // TODO this may be a bug
  // need to confirm that the padding is no more or less than 1 byte
  if (/521/.test(opts.jwk.crv) || len >= 511) {
    return '512';
  } else if (/384/.test(opts.jwk.crv) || len >= 383) {
    return '384';
  }

  return '256';
};
Keypairs._getName = function (opts) {
  if (/EC/i.test(opts.jwk.kty)) {
    return 'ECDSA';
  } else {
    return 'RSASSA-PKCS1-v1_5';
  }
};
Keypairs._import = function (opts) {
  return Promise.resolve().then(function () {
    var ops;
    // all private keys just happen to have a 'd'
    if (opts.jwk.d) {
      ops = [ 'sign' ];
    } else {
      ops = [ 'verify' ];
    }
    // gotta mark it as extractable, as if it matters
    opts.jwk.ext = true;
    opts.jwk.key_ops = ops;

    return window.crypto.subtle.importKey(
      "jwk"
    , opts.jwk
    , { name: Keypairs._getName(opts)
      , namedCurve: opts.jwk.crv
      , hash: { name: 'SHA-' + Keypairs._getBits(opts) } }
    , true
    , ops
    ).then(function (privkey) {
      delete opts.jwk.ext;
      return privkey;
    });
  });
};
// ECDSA JOSE / JWS / JWT signatures differ from "normal" ASN1/X509 ECDSA signatures
// https://tools.ietf.org/html/rfc7518#section-3.4
Keypairs._ecdsaJoseSigToAsn1Sig = function (bufsig) {
  // it's easier to do the manipulation in the browser with an array
  bufsig = Array.from(bufsig);
  var hlen = bufsig.length / 2; // should be even
  var r = bufsig.slice(0, hlen);
  var s = bufsig.slice(hlen);
  // unpad positive ints less than 32 bytes wide
  while (!r[0]) { r = r.slice(1); }
  while (!s[0]) { s = s.slice(1); }
  // pad (or re-pad) ambiguously non-negative BigInts, up to 33 bytes wide
  if (0x80 & r[0]) { r.unshift(0); }
  if (0x80 & s[0]) { s.unshift(0); }

  var len = 2 + r.length + 2 + s.length;
  var head = [0x30];
  // hard code 0x80 + 1 because it won't be longer than
  // two SHA512 plus two pad bytes (130 bytes <= 256)
  if (len >= 0x80) { head.push(0x81); }
  head.push(len);

  return Uint8Array.from(head.concat([0x02, r.length], r, [0x02, s.length], s));
};

function setTime(time) {
  if ('number' === typeof time) { return time; }

  var t = time.match(/^(\-?\d+)([dhms])$/i);
  if (!t || !t[0]) {
    throw new Error("'" + time + "' should be datetime in seconds or human-readable format (i.e. 3d, 1h, 15m, 30s");
  }

  var now = Math.round(Date.now()/1000);
  var num = parseInt(t[1], 10);
  var unit = t[2];
  var mult = 1;
  switch(unit) {
    // fancy fallthrough, what fun!
    case 'd':
      mult *= 24;
      /*falls through*/
    case 'h':
      mult *= 60;
      /*falls through*/
    case 'm':
      mult *= 60;
      /*falls through*/
    case 's':
      mult *= 1;
  }

  return now + (mult * num);
}

Enc.hexToBuf = function (hex) {
  var arr = [];
  hex.match(/.{2}/g).forEach(function (h) {
    arr.push(parseInt(h, 16));
  });
  return 'undefined' !== typeof Uint8Array ? new Uint8Array(arr) : arr;
};
Enc.strToUrlBase64 = function (str) {
  return Enc.bufToUrlBase64(Enc.binToBuf(str));
};
Enc.binToBuf = function (bin) {
  var arr = bin.split('').map(function (ch) {
    return ch.charCodeAt(0);
  });
  return 'undefined' !== typeof Uint8Array ? new Uint8Array(arr) : arr;
};

}('undefined' !== typeof module ? module.exports : window));
// Copyright 2018 AJ ONeal. All rights reserved
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
;(function (exports) {
'use strict';

if (!exports.ASN1) { exports.ASN1 = {}; }
if (!exports.Enc) { exports.Enc = {}; }
if (!exports.PEM) { exports.PEM = {}; }

var ASN1 = exports.ASN1;
var Enc = exports.Enc;
var PEM = exports.PEM;

//
// Parser
//

// Although I've only seen 9 max in https certificates themselves,
// but each domain list could have up to 100
ASN1.ELOOPN = 102;
ASN1.ELOOP = "uASN1.js Error: iterated over " + ASN1.ELOOPN + "+ elements (probably a malformed file)";
// I've seen https certificates go 29 deep
ASN1.EDEEPN = 60;
ASN1.EDEEP = "uASN1.js Error: element nested " + ASN1.EDEEPN + "+ layers deep (probably a malformed file)";
// Container Types are Sequence 0x30, Container Array? (0xA0, 0xA1)
// Value Types are Boolean 0x01, Integer 0x02, Null 0x05, Object ID 0x06, String 0x0C, 0x16, 0x13, 0x1e Value Array? (0x82)
// Bit String (0x03) and Octet String (0x04) may be values or containers
// Sometimes Bit String is used as a container (RSA Pub Spki)
ASN1.CTYPES = [ 0x30, 0x31, 0xa0, 0xa1 ];
ASN1.VTYPES = [ 0x01, 0x02, 0x05, 0x06, 0x0c, 0x82 ];
ASN1.parse = function parseAsn1Helper(buf) {
  //var ws = '  ';
  function parseAsn1(buf, depth, eager) {
    if (depth.length >= ASN1.EDEEPN) { throw new Error(ASN1.EDEEP); }

    var index = 2; // we know, at minimum, data starts after type (0) and lengthSize (1)
    var asn1 = { type: buf[0], lengthSize: 0, length: buf[1] };
    var child;
    var iters = 0;
    var adjust = 0;
    var adjustedLen;

    // Determine how many bytes the length uses, and what it is
    if (0x80 & asn1.length) {
      asn1.lengthSize = 0x7f & asn1.length;
      // I think that buf->hex->int solves the problem of Endianness... not sure
      asn1.length = parseInt(Enc.bufToHex(buf.slice(index, index + asn1.lengthSize)), 16);
      index += asn1.lengthSize;
    }

    // High-order bit Integers have a leading 0x00 to signify that they are positive.
    // Bit Streams use the first byte to signify padding, which x.509 doesn't use.
    if (0x00 === buf[index] && (0x02 === asn1.type || 0x03 === asn1.type)) {
      // However, 0x00 on its own is a valid number
      if (asn1.length > 1) {
        index += 1;
        adjust = -1;
      }
    }
    adjustedLen = asn1.length + adjust;

    //console.warn(depth.join(ws) + '0x' + Enc.numToHex(asn1.type), index, 'len:', asn1.length, asn1);

    function parseChildren(eager) {
      asn1.children = [];
      //console.warn('1 len:', (2 + asn1.lengthSize + asn1.length), 'idx:', index, 'clen:', 0);
      while (iters < ASN1.ELOOPN && index < (2 + asn1.length + asn1.lengthSize)) {
        iters += 1;
        depth.length += 1;
        child = parseAsn1(buf.slice(index, index + adjustedLen), depth, eager);
        depth.length -= 1;
        // The numbers don't match up exactly and I don't remember why...
        // probably something with adjustedLen or some such, but the tests pass
        index += (2 + child.lengthSize + child.length);
        //console.warn('2 len:', (2 + asn1.lengthSize + asn1.length), 'idx:', index, 'clen:', (2 + child.lengthSize + child.length));
        if (index > (2 + asn1.lengthSize + asn1.length)) {
          if (!eager) { console.error(JSON.stringify(asn1, ASN1._replacer, 2)); }
          throw new Error("Parse error: child value length (" + child.length
            + ") is greater than remaining parent length (" + (asn1.length - index)
            + " = " + asn1.length + " - " + index + ")");
        }
        asn1.children.push(child);
        //console.warn(depth.join(ws) + '0x' + Enc.numToHex(asn1.type), index, 'len:', asn1.length, asn1);
      }
      if (index !== (2 + asn1.lengthSize + asn1.length)) {
        //console.warn('index:', index, 'length:', (2 + asn1.lengthSize + asn1.length));
        throw new Error("premature end-of-file");
      }
      if (iters >= ASN1.ELOOPN) { throw new Error(ASN1.ELOOP); }

      delete asn1.value;
      return asn1;
    }

    // Recurse into types that are _always_ containers
    if (-1 !== ASN1.CTYPES.indexOf(asn1.type)) { return parseChildren(eager); }

    // Return types that are _always_ values
    asn1.value = buf.slice(index, index + adjustedLen);
    if (-1 !== ASN1.VTYPES.indexOf(asn1.type)) { return asn1; }

    // For ambigious / unknown types, recurse and return on failure
    // (and return child array size to zero)
    try { return parseChildren(true); }
    catch(e) { asn1.children.length = 0; return asn1; }
  }

  var asn1 = parseAsn1(buf, []);
  var len = buf.byteLength || buf.length;
  if (len !== 2 + asn1.lengthSize + asn1.length) {
    throw new Error("Length of buffer does not match length of ASN.1 sequence.");
  }
  return asn1;
};
ASN1._replacer = function (k, v) {
  if ('type' === k) { return '0x' + Enc.numToHex(v); }
  if (v && 'value' === k) { return '0x' + Enc.bufToHex(v.data || v); }
  return v;
};

// don't replace the full parseBlock, if it exists
PEM.parseBlock = PEM.parseBlock || function (str) {
  var der = str.split(/\n/).filter(function (line) {
    return !/-----/.test(line);
  }).join('');
  return { bytes: Enc.base64ToBuf(der) };
};

Enc.base64ToBuf = function (b64) {
  return Enc.binToBuf(atob(b64));
};
Enc.binToBuf = function (bin) {
  var arr = bin.split('').map(function (ch) {
    return ch.charCodeAt(0);
  });
  return 'undefined' !== typeof Uint8Array ? new Uint8Array(arr) : arr;
};
Enc.bufToHex = function (u8) {
  var hex = [];
  var i, h;
  var len = (u8.byteLength || u8.length);

  for (i = 0; i < len; i += 1) {
    h = u8[i].toString(16);
    if (h.length % 2) { h = '0' + h; }
    hex.push(h);
  }

  return hex.join('').toLowerCase();
};
Enc.numToHex = function (d) {
  d = d.toString(16);
  if (d.length % 2) {
    return '0' + d;
  }
  return d;
};

}('undefined' !== typeof window ? window : module.exports));
// Copyright 2018-present AJ ONeal. All rights reserved
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function (exports) {
'use strict';
/*global Promise*/

var ASN1 = exports.ASN1;
var Enc = exports.Enc;
var PEM = exports.PEM;
var X509 = exports.x509;
var Keypairs = exports.Keypairs;

// TODO find a way that the prior node-ish way of `module.exports = function () {}` isn't broken
var CSR = exports.CSR = function (opts) {
  // We're using a Promise here to be compatible with the browser version
  // which will probably use the webcrypto API for some of the conversions
  return CSR._prepare(opts).then(function (opts) {
    return CSR.create(opts).then(function (bytes) {
      return CSR._encode(opts, bytes);
    });
  });
};

CSR._prepare = function (opts) {
  return Promise.resolve().then(function () {
    var Keypairs;
    opts = JSON.parse(JSON.stringify(opts));

    // We do a bit of extra error checking for user convenience
    if (!opts) { throw new Error("You must pass options with key and domains to rsacsr"); }
    if (!Array.isArray(opts.domains) || 0 === opts.domains.length) {
      new Error("You must pass options.domains as a non-empty array");
    }

    // I need to check that 例.中国 is a valid domain name
    if (!opts.domains.every(function (d) {
      // allow punycode? xn--
      if ('string' === typeof d /*&& /\./.test(d) && !/--/.test(d)*/) {
        return true;
      }
    })) {
      throw new Error("You must pass options.domains as strings");
    }

    if (opts.jwk) { return opts; }
    if (opts.key && opts.key.kty) {
      opts.jwk = opts.key;
      return opts;
    }
    if (!opts.pem && !opts.key) {
      throw new Error("You must pass options.key as a JSON web key");
    }

    Keypairs = exports.Keypairs;
    if (!exports.Keypairs) {
      throw new Error("Keypairs.js is an optional dependency for PEM-to-JWK.\n"
        + "Install it if you'd like to use it:\n"
        + "\tnpm install --save rasha\n"
        + "Otherwise supply a jwk as the private key."
      );
    }

    return Keypairs.import({ pem: opts.pem || opts.key }).then(function (pair) {
      opts.jwk = pair.private;
      return opts;
    });
  });
};

CSR._encode = function (opts, bytes) {
  if ('der' === (opts.encoding||'').toLowerCase()) {
    return bytes;
  }
  return PEM.packBlock({
    type: "CERTIFICATE REQUEST"
  , bytes: bytes /* { jwk: jwk, domains: opts.domains } */
  });
};

CSR.create = function createCsr(opts) {
  var hex = CSR.request(opts.jwk, opts.domains);
  return CSR._sign(opts.jwk, hex).then(function (csr) {
    return Enc.hexToBuf(csr);
  });
};

//
// EC / RSA
//
CSR.request = function createCsrBodyEc(jwk, domains) {
  var asn1pub;
  if (/^EC/i.test(jwk.kty)) {
    asn1pub = X509.packCsrEcPublicKey(jwk);
  } else {
    asn1pub = X509.packCsrRsaPublicKey(jwk);
  }
  return X509.packCsr(asn1pub, domains);
};

CSR._sign = function csrEcSig(jwk, request) {
  // Took some tips from https://gist.github.com/codermapuche/da4f96cdb6d5ff53b7ebc156ec46a10a
  // TODO will have to convert web ECDSA signatures to PEM ECDSA signatures (but RSA should be the same)
  // TODO have a consistent non-private way to sign
  return Keypairs._sign({ jwk: jwk, format: 'x509' }, Enc.hexToBuf(request)).then(function (sig) {
    return CSR._toDer({ request: request, signature: sig, kty: jwk.kty });
  });
};

CSR._toDer = function encode(opts) {
  var sty;
  if (/^EC/i.test(opts.kty)) {
    // 1.2.840.10045.4.3.2 ecdsaWithSHA256 (ANSI X9.62 ECDSA algorithm with SHA256)
    sty = ASN1('30', ASN1('06', '2a8648ce3d040302'));
  } else {
    // 1.2.840.113549.1.1.11 sha256WithRSAEncryption (PKCS #1)
    sty = ASN1('30', ASN1('06', '2a864886f70d01010b'), ASN1('05'));
  }
  return ASN1('30'
    // The Full CSR Request Body
  , opts.request
    // The Signature Type
  , sty
    // The Signature
  , ASN1.BitStr(Enc.bufToHex(opts.signature))
  );
};

X509.packCsr = function (asn1pubkey, domains) {
  return ASN1('30'
    // Version (0)
  , ASN1.UInt('00')

    // 2.5.4.3 commonName (X.520 DN component)
  , ASN1('30', ASN1('31', ASN1('30', ASN1('06', '550403'), ASN1('0c', Enc.utf8ToHex(domains[0])))))

    // Public Key (RSA or EC)
  , asn1pubkey

    // Request Body
  , ASN1('a0'
    , ASN1('30'
        // 1.2.840.113549.1.9.14 extensionRequest (PKCS #9 via CRMF)
      , ASN1('06', '2a864886f70d01090e')
      , ASN1('31'
        , ASN1('30'
          , ASN1('30'
              // 2.5.29.17 subjectAltName (X.509 extension)
            , ASN1('06', '551d11')
            , ASN1('04'
              , ASN1('30', domains.map(function (d) {
                  return ASN1('82', Enc.utf8ToHex(d));
                }).join(''))))))))
  );
};

// TODO finish this later
// we want to parse the domains, the public key, and verify the signature
CSR._info = function (der) {
  // standard base64 PEM
  if ('string' === typeof der && '-' === der[0]) {
    der = PEM.parseBlock(der).bytes;
  }
  // jose urlBase64 not-PEM
  if ('string' === typeof der) {
    der = Enc.base64ToBuf(der);
  }
  // not supporting binary-encoded bas64
  var c = ASN1.parse(der);
  var kty;
  // A cert has 3 parts: cert, signature meta, signature
  if (c.children.length !== 3) {
    throw new Error("doesn't look like a certificate request: expected 3 parts of header");
  }
  var sig = c.children[2];
  if (sig.children.length) {
    // ASN1/X509 EC
    sig = sig.children[0];
    sig = ASN1('30', ASN1.UInt(Enc.bufToHex(sig.children[0].value)), ASN1.UInt(Enc.bufToHex(sig.children[1].value)));
    sig = Enc.hexToBuf(sig);
    kty = 'EC';
  } else {
    // Raw RSA Sig
    sig = sig.value;
    kty = 'RSA';
  }
  //c.children[1]; // signature type
  var req = c.children[0];
  // TODO utf8
  if (4 !== req.children.length) {
    throw new Error("doesn't look like a certificate request: expected 4 parts to request");
  }
  // 0 null
  // 1 commonName / subject
  var sub = Enc.bufToBin(req.children[1].children[0].children[0].children[1].value);
  // 3 public key (type, key)
  //console.log('oid', Enc.bufToHex(req.children[2].children[0].children[0].value));
  var pub;
  // TODO reuse ASN1 parser for these?
  if ('EC' === kty) {
    // throw away compression byte
    pub = req.children[2].children[1].value.slice(1);
    pub = { kty: kty, x: pub.slice(0, 32), y: pub.slice(32) };
    while (0 === pub.x[0]) { pub.x = pub.x.slice(1); }
    while (0 === pub.y[0]) { pub.y = pub.y.slice(1); }
    if ((pub.x.length || pub.x.byteLength) > 48) {
      pub.crv = 'P-521';
    } else if ((pub.x.length || pub.x.byteLength) > 32) {
      pub.crv = 'P-384';
    } else {
      pub.crv = 'P-256';
    }
    pub.x = Enc.bufToUrlBase64(pub.x);
    pub.y = Enc.bufToUrlBase64(pub.y);
  } else {
    pub = req.children[2].children[1].children[0];
    pub = { kty: kty, n: pub.children[0].value, e: pub.children[1].value };
    while (0 === pub.n[0]) { pub.n = pub.n.slice(1); }
    while (0 === pub.e[0]) { pub.e = pub.e.slice(1); }
    pub.n = Enc.bufToUrlBase64(pub.n);
    pub.e = Enc.bufToUrlBase64(pub.e);
  }
  // 4 extensions
  var domains = req.children[3].children.filter(function (seq) {
    //  1.2.840.113549.1.9.14 extensionRequest (PKCS #9 via CRMF)
    if ('2a864886f70d01090e' === Enc.bufToHex(seq.children[0].value)) {
      return true;
    }
  }).map(function (seq) {
    return seq.children[1].children[0].children.filter(function (seq2) {
      // subjectAltName (X.509 extension)
      if ('551d11' === Enc.bufToHex(seq2.children[0].value)) {
        return true;
      }
    }).map(function (seq2) {
      return seq2.children[1].children[0].children.map(function (name) {
        // TODO utf8
        return Enc.bufToBin(name.value);
      });
    })[0];
  })[0];

  return {
    subject: sub
  , altnames: domains
  , jwk: pub
  , signature: sig
  };
};

X509.packCsrRsaPublicKey = function (jwk) {
  // Sequence the key
  var n = ASN1.UInt(Enc.base64ToHex(jwk.n));
  var e = ASN1.UInt(Enc.base64ToHex(jwk.e));
  var asn1pub = ASN1('30', n, e);

  // Add the CSR pub key header
  return ASN1('30', ASN1('30', ASN1('06', '2a864886f70d010101'), ASN1('05')), ASN1.BitStr(asn1pub));
};

X509.packCsrEcPublicKey = function (jwk) {
  var ecOid = X509._oids[jwk.crv];
  if (!ecOid) {
    throw new Error("Unsupported namedCurve '" + jwk.crv + "'. Supported types are " + Object.keys(X509._oids));
  }
  var cmp = '04'; // 04 == x+y, 02 == x-only
  var hxy = '';
  // Placeholder. I'm not even sure if compression should be supported.
  if (!jwk.y) { cmp = '02'; }
  hxy += Enc.base64ToHex(jwk.x);
  if (jwk.y) { hxy += Enc.base64ToHex(jwk.y); }

  // 1.2.840.10045.2.1 ecPublicKey
  return ASN1('30', ASN1('30', ASN1('06', '2a8648ce3d0201'), ASN1('06', ecOid)), ASN1.BitStr(cmp + hxy));
};
X509._oids = {
  // 1.2.840.10045.3.1.7 prime256v1
  // (ANSI X9.62 named elliptic curve) (06 08 - 2A 86 48 CE 3D 03 01 07)
  'P-256': '2a8648ce3d030107'
  // 1.3.132.0.34 P-384 (06 05 - 2B 81 04 00 22)
  // (SEC 2 recommended EC domain secp256r1)
, 'P-384': '2b81040022'
  // requires more logic and isn't a recommended standard
  // 1.3.132.0.35 P-521 (06 05 - 2B 81 04 00 23)
  // (SEC 2 alternate P-521)
//, 'P-521': '2B 81 04 00 23'
};

// don't replace the full parseBlock, if it exists
PEM.parseBlock = PEM.parseBlock || function (str) {
  var der = str.split(/\n/).filter(function (line) {
    return !/-----/.test(line);
  }).join('');
  return { bytes: Enc.base64ToBuf(der) };
};

}('undefined' === typeof window ? module.exports : window));
// Copyright 2018-present AJ ONeal. All rights reserved
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function (exports) {
'use strict';
/* globals Promise */

var ACME = exports.ACME = {};
//var Keypairs = exports.Keypairs || {};
//var CSR = exports.CSR;
var Enc = exports.Enc || {};
var Crypto = exports.Crypto || {};

ACME.formatPemChain = function formatPemChain(str) {
  return str.trim().replace(/[\r\n]+/g, '\n').replace(/\-\n\-/g, '-\n\n-') + '\n';
};
ACME.splitPemChain = function splitPemChain(str) {
  return str.trim().split(/[\r\n]{2,}/g).map(function (str) {
    return str + '\n';
  });
};


// http-01: GET https://example.org/.well-known/acme-challenge/{{token}} => {{keyAuth}}
// dns-01: TXT _acme-challenge.example.org. => "{{urlSafeBase64(sha256(keyAuth))}}"
ACME.challengePrefixes = {
  'http-01': '/.well-known/acme-challenge'
, 'dns-01': '_acme-challenge'
};
ACME.challengeTests = {
  'http-01': function (me, auth) {
    return me.http01(auth).then(function (keyAuth) {
      var err;

      // TODO limit the number of bytes that are allowed to be downloaded
      if (auth.keyAuthorization === (keyAuth||'').trim()) {
        return true;
      }

      err = new Error(
        "Error: Failed HTTP-01 Pre-Flight / Dry Run.\n"
      + "curl '" + auth.challengeUrl + "'\n"
      + "Expected: '" + auth.keyAuthorization + "'\n"
      + "Got: '" + keyAuth + "'\n"
      + "See https://git.coolaj86.com/coolaj86/acme-v2.js/issues/4"
      );
      err.code = 'E_FAIL_DRY_CHALLENGE';
      return Promise.reject(err);
    });
  }
, 'dns-01': function (me, auth) {
    // remove leading *. on wildcard domains
    return me.dns01(auth).then(function (ans) {
      var err;

      if (ans.answer.some(function (txt) {
        return auth.dnsAuthorization === txt.data[0];
      })) {
        return true;
      }

      err = new Error(
        "Error: Failed DNS-01 Pre-Flight Dry Run.\n"
      + "dig TXT '" + auth.dnsHost + "' does not return '" + auth.dnsAuthorization + "'\n"
      + "See https://git.coolaj86.com/coolaj86/acme-v2.js/issues/4"
      );
      err.code = 'E_FAIL_DRY_CHALLENGE';
      return Promise.reject(err);
    });
  }
};

ACME._directory = function (me) {
  // GET-as-GET ok
  return me.request({ method: 'GET', url: me.directoryUrl, json: true });
};
ACME._getNonce = function (me) {
  // GET-as-GET, HEAD-as-HEAD ok
  var nonce;
  while (true) {
    nonce = me._nonces.shift();
    if (!nonce) { break; }
    if (Date.now() - nonce.createdAt > (15 * 60 * 1000)) {
      nonce = null;
    } else {
      break;
    }
  }
  if (nonce) { return Promise.resolve(nonce.nonce); }
  return me.request({ method: 'HEAD', url: me._directoryUrls.newNonce }).then(function (resp) {
    return resp.headers['replay-nonce'];
  });
};
ACME._setNonce = function (me, nonce) {
  me._nonces.unshift({ nonce: nonce, createdAt: Date.now() });
};
// ACME RFC Section 7.3 Account Creation
/*
 {
   "protected": base64url({
     "alg": "ES256",
     "jwk": {...},
     "nonce": "6S8IqOGY7eL2lsGoTZYifg",
     "url": "https://example.com/acme/new-account"
   }),
   "payload": base64url({
     "termsOfServiceAgreed": true,
     "onlyReturnExisting": false,
     "contact": [
       "mailto:cert-admin@example.com",
       "mailto:admin@example.com"
     ]
   }),
   "signature": "RZPOnYoPs1PhjszF...-nh6X1qtOFPB519I"
 }
*/
ACME._registerAccount = function (me, options) {
  if (me.debug) { console.debug('[acme-v2] accounts.create'); }

  return new Promise(function (resolve, reject) {

    function agree(tosUrl) {
      var err;
      if (me._tos !== tosUrl) {
        err = new Error("You must agree to the ToS at '" + me._tos + "'");
        err.code = "E_AGREE_TOS";
        reject(err);
        return;
      }

      return ACME._importKeypair(me, options.accountKeypair).then(function (pair) {
        var contact;
        if (options.contact) {
          contact = options.contact.slice(0);
        } else if (options.email) {
          contact = [ 'mailto:' + options.email ];
        }
        var body = {
          termsOfServiceAgreed: tosUrl === me._tos
        , onlyReturnExisting: false
        , contact: contact
        };
        var pExt;
        if (options.externalAccount) {
          pExt = me.Keypairs.signJws({
            // TODO is HMAC the standard, or is this arbitrary?
            secret: options.externalAccount.secret
          , protected: {
              alg: options.externalAccount.alg || "HS256"
            , kid: options.externalAccount.id
            , url: me._directoryUrls.newAccount
            }
          , payload: Enc.binToBuf(JSON.stringify(pair.public))
          }).then(function (jws) {
            body.externalAccountBinding = jws;
            return body;
          });
        } else {
          pExt = Promise.resolve(body);
        }
        return pExt.then(function (body) {
          var payload = JSON.stringify(body);
          return ACME._jwsRequest(me, {
            options: options
          , url: me._directoryUrls.newAccount
          , protected: { kid: false, jwk: pair.public }
          , payload: Enc.binToBuf(payload)
          }).then(function (resp) {
            var account = resp.body;

            if (2 !== Math.floor(resp.statusCode / 100)) {
              throw new Error('account error: ' + JSON.stringify(resp.body));
            }

            var location = resp.headers.location;
            // the account id url
            options._kid = location;
            if (me.debug) { console.debug('[DEBUG] new account location:'); }
            if (me.debug) { console.debug(location); }
            if (me.debug) { console.debug(resp); }

            /*
            {
              contact: ["mailto:jon@example.com"],
              orders: "https://some-url",
              status: 'valid'
            }
            */
            if (!account) { account = { _emptyResponse: true }; }
            // https://git.coolaj86.com/coolaj86/acme-v2.js/issues/8
            if (!account.key) { account.key = {}; }
            account.key.kid = options._kid;
            return account;
          }).then(resolve, reject);
        });
      });
    }

    if (me.debug) { console.debug('[acme-v2] agreeToTerms'); }
    if (1 === options.agreeToTerms.length) {
      // newer promise API
      return Promise.resolve(options.agreeToTerms(me._tos)).then(agree, reject);
    }
    else if (2 === options.agreeToTerms.length) {
      // backwards compat cb API
      return options.agreeToTerms(me._tos, function (err, tosUrl) {
        if (!err) { agree(tosUrl); return; }
        reject(err);
      });
    }
    else {
      reject(new Error('agreeToTerms has incorrect function signature.'
        + ' Should be fn(tos) { return Promise<tos>; }'));
    }
  });
};
/*
 POST /acme/new-order HTTP/1.1
 Host: example.com
 Content-Type: application/jose+json

 {
   "protected": base64url({
     "alg": "ES256",
     "kid": "https://example.com/acme/acct/1",
     "nonce": "5XJ1L3lEkMG7tR6pA00clA",
     "url": "https://example.com/acme/new-order"
   }),
   "payload": base64url({
     "identifiers": [{"type:"dns","value":"example.com"}],
     "notBefore": "2016-01-01T00:00:00Z",
     "notAfter": "2016-01-08T00:00:00Z"
   }),
   "signature": "H6ZXtGjTZyUnPeKn...wEA4TklBdh3e454g"
 }
*/
ACME._getChallenges = function (me, options, authUrl) {
  if (me.debug) { console.debug('\n[DEBUG] getChallenges\n'); }
  // TODO POST-as-GET

  return ACME._jwsRequest(me, {
    options: options
  , protected: {}
  , payload: ''
  , url: authUrl
  }).then(function (resp) {
    return resp.body;
  });
};
ACME._wait = function wait(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, (ms || 1100));
  });
};

ACME._testChallengeOptions = function () {
  var chToken = ACME._prnd(16);
  return [
    {
      "type": "http-01",
      "status": "pending",
      "url": "https://acme-staging-v02.example.com/0",
      "token": "test-" + chToken + "-0"
    }
  , {
      "type": "dns-01",
      "status": "pending",
      "url": "https://acme-staging-v02.example.com/1",
      "token": "test-" + chToken + "-1",
      "_wildcard": true
    }
  , {
      "type": "tls-sni-01",
      "status": "pending",
      "url": "https://acme-staging-v02.example.com/2",
      "token": "test-" + chToken + "-2"
    }
  , {
      "type": "tls-alpn-01",
      "status": "pending",
      "url": "https://acme-staging-v02.example.com/3",
      "token": "test-" + chToken + "-3"
    }
  ];
};
ACME._testChallenges = function (me, options) {
  var CHECK_DELAY = 0;
  return Promise.all(options.domains.map(function (identifierValue) {
    // TODO we really only need one to pass, not all to pass
    var challenges = ACME._testChallengeOptions();
    if (identifierValue.includes("*")) {
      challenges = challenges.filter(function (ch) { return ch._wildcard; });
    }

    var challenge = ACME._chooseChallenge(options, { challenges: challenges });
    if (!challenge) {
      // For example, wildcards require dns-01 and, if we don't have that, we have to bail
      var enabled = options.challengeTypes.join(', ') || 'none';
      var suitable = challenges.map(function (r) { return r.type; }).join(', ') || 'none';
      return Promise.reject(new Error(
        "None of the challenge types that you've enabled ( " + enabled + " )"
          + " are suitable for validating the domain you've selected (" + identifierValue + ")."
          + " You must enable one of ( " + suitable + " )."
      ));
    }

    // TODO remove skipChallengeTest
    if (me.skipDryRun || me.skipChallengeTest) {
      return null;
    }

    if ('dns-01' === challenge.type) {
      // Give the nameservers a moment to propagate
      CHECK_DELAY = 1.5 * 1000;
    }

    return Promise.resolve().then(function () {
      var results = {
        identifier: {
          type: "dns"
        , value: identifierValue.replace(/^\*\./, '')
        }
      , challenges: [ challenge ]
      , expires: new Date(Date.now() + (60 * 1000)).toISOString()
      , wildcard: identifierValue.includes('*.') || undefined
      };

      // The dry-run comes first in the spirit of "fail fast"
      // (and protecting against challenge failure rate limits)
      var dryrun = true;
      return ACME._challengeToAuth(me, options, results, challenge, dryrun).then(function (auth) {
        if (!me._canUse[auth.type]) { return; }
        return ACME._setChallenge(me, options, auth).then(function () {
          return auth;
        });
      });
    });
  })).then(function (auths) {
    auths = auths.filter(Boolean);
    if (!auths.length) { /*skip actual test*/ return; }
    return ACME._wait(CHECK_DELAY).then(function () {
      return Promise.all(auths.map(function (auth) {
        return ACME.challengeTests[auth.type](me, auth).then(function (result) {
          // not a blocker
          ACME._removeChallenge(me, options, auth);
          return result;
        });
      }));
    });
  });
};
ACME._chooseChallenge = function(options, results) {
  // For each of the challenge types that we support
  var challenge;
  options.challengeTypes.some(function (chType) {
    // And for each of the challenge types that are allowed
    return results.challenges.some(function (ch) {
      // Check to see if there are any matches
      if (ch.type === chType) {
        challenge = ch;
        return true;
      }
    });
  });

  return challenge;
};
ACME._challengeToAuth = function (me, options, request, challenge, dryrun) {
  // we don't poison the dns cache with our dummy request
  var dnsPrefix = ACME.challengePrefixes['dns-01'];
  if (dryrun) {
    dnsPrefix = dnsPrefix.replace('acme-challenge', 'greenlock-dryrun-' + ACME._prnd(4));
  }

  var auth = {};

  // straight copy from the new order response
  // { identifier, status, expires, challenges, wildcard }
  Object.keys(request).forEach(function (key) {
    auth[key] = request[key];
  });

  // copy from the challenge we've chosen
  // { type, status, url, token }
  // (note the duplicate status overwrites the one above, but they should be the same)
  Object.keys(challenge).forEach(function (key) {
    // don't confused devs with the id url
    auth[key] = challenge[key];
  });

  // batteries-included helpers
  auth.hostname = auth.identifier.value;
  // because I'm not 100% clear if the wildcard identifier does or doesn't have the leading *. in all cases
  auth.altname = ACME._untame(auth.identifier.value, auth.wildcard);
  return ACME._importKeypair(me, options.accountKeypair).then(function (pair) {
    return me.Keypairs.thumbprint({ jwk: pair.public }).then(function (thumb) {
      auth.thumbprint = thumb;
      //   keyAuthorization = token || '.' || base64url(JWK_Thumbprint(accountKey))
      auth.keyAuthorization = challenge.token + '.' + auth.thumbprint;
      // conflicts with ACME challenge id url is already in use, so we call this challengeUrl instead
      // TODO auth.http01Url ?
      auth.challengeUrl = 'http://' + auth.identifier.value + ACME.challengePrefixes['http-01'] + '/' + auth.token;
      auth.dnsHost = dnsPrefix + '.' + auth.hostname.replace('*.', '');

      return Crypto._sha('sha256', auth.keyAuthorization).then(function (hash) {
        auth.dnsAuthorization = hash;
        return auth;
      });
    });
  });
};

ACME._untame = function (name, wild) {
  if (wild) { name = '*.' + name.replace('*.', ''); }
  return name;
};

// https://tools.ietf.org/html/draft-ietf-acme-acme-10#section-7.5.1
ACME._postChallenge = function (me, options, auth) {
  var RETRY_INTERVAL = me.retryInterval || 1000;
  var DEAUTH_INTERVAL = me.deauthWait || 10 * 1000;
  var MAX_POLL = me.retryPoll || 8;
  var MAX_PEND = me.retryPending || 4;
  var count = 0;

  var altname = ACME._untame(auth.identifier.value, auth.wildcard);

  /*
   POST /acme/authz/1234 HTTP/1.1
   Host: example.com
   Content-Type: application/jose+json

   {
     "protected": base64url({
       "alg": "ES256",
       "kid": "https://example.com/acme/acct/1",
       "nonce": "xWCM9lGbIyCgue8di6ueWQ",
       "url": "https://example.com/acme/authz/1234"
     }),
     "payload": base64url({
       "status": "deactivated"
     }),
     "signature": "srX9Ji7Le9bjszhu...WTFdtujObzMtZcx4"
   }
   */
  function deactivate() {
    if (me.debug) { console.debug('[acme-v2.js] deactivate:'); }
    return ACME._jwsRequest(me, {
      options: options
    , url: auth.url
    , protected: { kid: options._kid }
    , payload: Enc.binToBuf(JSON.stringify({ "status": "deactivated" }))
    }).then(function (resp) {
      if (me.debug) { console.debug('deactivate challenge: resp.body:'); }
      if (me.debug) { console.debug(resp.body); }
      return ACME._wait(DEAUTH_INTERVAL);
    });
  }

  function pollStatus() {
    if (count >= MAX_POLL) {
      return Promise.reject(new Error(
        "[acme-v2] stuck in bad pending/processing state for '" + altname + "'"
      ));
    }

    count += 1;

    if (me.debug) { console.debug('\n[DEBUG] statusChallenge\n'); }
    // TODO POST-as-GET
    return me.request({ method: 'GET', url: auth.url, json: true }).then(function (resp) {
      if ('processing' === resp.body.status) {
        if (me.debug) { console.debug('poll: again'); }
        return ACME._wait(RETRY_INTERVAL).then(pollStatus);
      }

      // This state should never occur
      if ('pending' === resp.body.status) {
        if (count >= MAX_PEND) {
          return ACME._wait(RETRY_INTERVAL).then(deactivate).then(respondToChallenge);
        }
        if (me.debug) { console.debug('poll: again'); }
        return ACME._wait(RETRY_INTERVAL).then(respondToChallenge);
      }

      if ('valid' === resp.body.status) {
        if (me.debug) { console.debug('poll: valid'); }

        try {
          ACME._removeChallenge(me, options, auth);
        } catch(e) {}
        return resp.body;
      }

      var errmsg;
      if (!resp.body.status) {
        errmsg = "[acme-v2] (E_STATE_EMPTY) empty challenge state for '" + altname + "':";
      }
      else if ('invalid' === resp.body.status) {
        errmsg = "[acme-v2] (E_STATE_INVALID) challenge state for '" + altname + "': '" + resp.body.status + "'";
      }
      else {
        errmsg = "[acme-v2] (E_STATE_UKN) challenge state for '" + altname + "': '" + resp.body.status + "'";
      }

      return Promise.reject(new Error(errmsg));
    });
  }

  function respondToChallenge() {
    if (me.debug) { console.debug('[acme-v2.js] responding to accept challenge:'); }
    return ACME._jwsRequest(me, {
      options: options
    , url: auth.url
    , protected: { kid: options._kid }
    , payload: Enc.binToBuf(JSON.stringify({}))
    }).then(function (resp) {
      if (me.debug) { console.debug('respond to challenge: resp.body:'); }
      if (me.debug) { console.debug(resp.body); }
      return ACME._wait(RETRY_INTERVAL).then(pollStatus);
    });
  }

  return respondToChallenge();
};
ACME._setChallenge = function (me, options, auth) {
  return new Promise(function (resolve, reject) {
    var challengers = options.challenges || {};
    var challenger = (challengers[auth.type] && challengers[auth.type].set) || options.setChallenge;
    try {
      if (1 === challenger.length) {
        challenger(auth).then(resolve).catch(reject);
      } else if (2 === challenger.length) {
        challenger(auth, function (err) {
          if(err) { reject(err); } else { resolve(); }
        });
      } else {
        // TODO remove this old backwards-compat
        var challengeCb = function(err) {
          if(err) { reject(err); } else { resolve(); }
        };
        // for backwards compat adding extra keys without changing params length
        Object.keys(auth).forEach(function (key) {
          challengeCb[key] = auth[key];
        });
        if (!ACME._setChallengeWarn) {
          console.warn("Please update to acme-v2 setChallenge(options) <Promise> or setChallenge(options, cb).");
          console.warn("The API has been changed for compatibility with all ACME / Let's Encrypt challenge types.");
          ACME._setChallengeWarn = true;
        }
        challenger(auth.identifier.value, auth.token, auth.keyAuthorization, challengeCb);
      }
    } catch(e) {
      reject(e);
    }
  }).then(function () {
    // TODO: Do we still need this delay? Or shall we leave it to plugins to account for themselves?
    var DELAY = me.setChallengeWait || 500;
    if (me.debug) { console.debug('\n[DEBUG] waitChallengeDelay %s\n', DELAY); }
    return ACME._wait(DELAY);
  });
};
ACME._finalizeOrder = function (me, options, validatedDomains) {
  if (me.debug) { console.debug('finalizeOrder:'); }
  return ACME._generateCsrWeb64(me, options, validatedDomains).then(function (csr) {
    var body = { csr: csr };
    var payload = JSON.stringify(body);

    function pollCert() {
      if (me.debug) { console.debug('[acme-v2.js] pollCert:'); }
      return ACME._jwsRequest(me, {
        options: options
      , url: options._finalize
      , protected: { kid: options._kid }
      , payload: Enc.binToBuf(payload)
      }).then(function (resp) {
        if (me.debug) { console.debug('order finalized: resp.body:'); }
        if (me.debug) { console.debug(resp.body); }

        // https://tools.ietf.org/html/draft-ietf-acme-acme-12#section-7.1.3
        // Possible values are: "pending" => ("invalid" || "ready") => "processing" => "valid"
        if ('valid' === resp.body.status) {
          options._expires = resp.body.expires;
          options._certificate = resp.body.certificate;

          return resp.body; // return order
        }

        if ('processing' === resp.body.status) {
          return ACME._wait().then(pollCert);
        }

        if (me.debug) { console.debug("Error: bad status:\n" + JSON.stringify(resp.body, null, 2)); }

        if ('pending' === resp.body.status) {
          return Promise.reject(new Error(
            "Did not finalize order: status 'pending'."
          + " Best guess: You have not accepted at least one challenge for each domain:\n"
          + "Requested: '" + options.domains.join(', ') + "'\n"
          + "Validated: '" + validatedDomains.join(', ') + "'\n"
          + JSON.stringify(resp.body, null, 2)
          ));
        }

        if ('invalid' === resp.body.status) {
          return Promise.reject(new Error(
            "Did not finalize order: status 'invalid'."
          + " Best guess: One or more of the domain challenges could not be verified"
          + " (or the order was canceled).\n"
          + "Requested: '" + options.domains.join(', ') + "'\n"
          + "Validated: '" + validatedDomains.join(', ') + "'\n"
          + JSON.stringify(resp.body, null, 2)
          ));
        }

        if ('ready' === resp.body.status) {
          return Promise.reject(new Error(
            "Did not finalize order: status 'ready'."
          + " Hmmm... this state shouldn't be possible here. That was the last state."
          + " This one should at least be 'processing'.\n"
          + "Requested: '" + options.domains.join(', ') + "'\n"
          + "Validated: '" + validatedDomains.join(', ') + "'\n"
          + JSON.stringify(resp.body, null, 2) + "\n\n"
          + "Please open an issue at https://git.coolaj86.com/coolaj86/acme-v2.js"
          ));
        }

        return Promise.reject(new Error(
          "Didn't finalize order: Unhandled status '" + resp.body.status + "'."
        + " This is not one of the known statuses...\n"
        + "Requested: '" + options.domains.join(', ') + "'\n"
        + "Validated: '" + validatedDomains.join(', ') + "'\n"
        + JSON.stringify(resp.body, null, 2) + "\n\n"
        + "Please open an issue at https://git.coolaj86.com/coolaj86/acme-v2.js"
        ));
      });
    }

    return pollCert();
  });
};
// _kid
// registerAccount
// postChallenge
// finalizeOrder
// getCertificate
ACME._getCertificate = function (me, options) {
  if (me.debug) { console.debug('[acme-v2] DEBUG get cert 1'); }

  // Lot's of error checking to inform the user of mistakes
  if (!(options.challengeTypes||[]).length) {
    options.challengeTypes = Object.keys(options.challenges||{});
  }
  if (!options.challengeTypes.length) {
    options.challengeTypes = [ options.challengeType ].filter(Boolean);
  }
  if (options.challengeType) {
    options.challengeTypes.sort(function (a, b) {
      if (a === options.challengeType) { return -1; }
      if (b === options.challengeType) { return 1; }
      return 0;
    });
    if (options.challengeType !== options.challengeTypes[0]) {
      return Promise.reject(new Error("options.challengeType is '" + options.challengeType + "',"
        + " which does not exist in the supplied types '" + options.challengeTypes.join(',') + "'"));
    }
  }
  // TODO check that all challengeTypes are represented in challenges
  if (!options.challengeTypes.length) {
    return Promise.reject(new Error("options.challengeTypes (string array) must be specified"
      + " (and in order of preferential priority)."));
  }
  if (options.csr) {
    // TODO validate csr signature
    options._csr = me.CSR._info(options.csr);
    options.domains = options._csr.altnames;
    if (options._csr.subject !== options.domains[0]) {
      return Promise.reject(new Error("certificate subject (commonName) does not match first altname (SAN)"));
    }
  }
  if (!(options.domains && options.domains.length)) {
    return Promise.reject(new Error("options.domains must be a list of string domain names,"
    + " with the first being the subject of the certificate (or options.subject must specified)."));
  }

  // It's just fine if there's no account, we'll go get the key id we need via the existing key
  options._kid = options._kid || options.accountKid
    || (options.account && (options.account.kid
      || (options.account.key && options.account.key.kid)));
  if (!options._kid) {
    //return Promise.reject(new Error("must include KeyID"));
    // This is an idempotent request. It'll return the same account for the same public key.
    return ACME._registerAccount(me, options).then(function (account) {
      options._kid = account.key.kid;
      // start back from the top
      return ACME._getCertificate(me, options);
    });
  }

  // Do a little dry-run / self-test
  return ACME._testChallenges(me, options).then(function () {
    if (me.debug) { console.debug('[acme-v2] certificates.create'); }
    var body = {
      // raw wildcard syntax MUST be used here
      identifiers: options.domains.sort(function (a, b) {
        // the first in the list will be the subject of the certificate, I believe (and hope)
        if (!options.subject) { return 0; }
        if (options.subject === a) { return -1; }
        if (options.subject === b) { return 1; }
        return 0;
      }).map(function (hostname) {
        return { type: "dns", value: hostname };
      })
      //, "notBefore": "2016-01-01T00:00:00Z"
      //, "notAfter": "2016-01-08T00:00:00Z"
    };

    var payload = JSON.stringify(body);
    if (me.debug) { console.debug('\n[DEBUG] newOrder\n'); }
    return ACME._jwsRequest(me, {
      options: options
    , url: me._directoryUrls.newOrder
    , protected: { kid: options._kid }
    , payload: Enc.binToBuf(payload)
    }).then(function (resp) {
      var location = resp.headers.location;
      var setAuths;
      var validAuths = [];
      var auths = [];
      if (me.debug) { console.debug('[ordered]', location); } // the account id url
      if (me.debug) { console.debug(resp); }
      options._authorizations = resp.body.authorizations;
      options._order = location;
      options._finalize = resp.body.finalize;
      //if (me.debug) console.debug('[DEBUG] finalize:', options._finalize); return;

      if (!options._authorizations) {
        return Promise.reject(new Error(
          "[acme-v2.js] authorizations were not fetched for '" + options.domains.join() + "':\n"
          + JSON.stringify(resp.body)
        ));
      }
      if (me.debug) { console.debug("[acme-v2] POST newOrder has authorizations"); }
      setAuths = options._authorizations.slice(0);

      function setNext() {
        var authUrl = setAuths.shift();
        if (!authUrl) { return; }

        return ACME._getChallenges(me, options, authUrl).then(function (results) {
          // var domain = options.domains[i]; // results.identifier.value

          // If it's already valid, we're golden it regardless
          if (results.challenges.some(function (ch) { return 'valid' === ch.status; })) {
            return setNext();
          }

          var challenge = ACME._chooseChallenge(options, results);
          if (!challenge) {
            // For example, wildcards require dns-01 and, if we don't have that, we have to bail
            return Promise.reject(new Error(
              "Server didn't offer any challenge we can handle for '" + options.domains.join() + "'."
            ));
          }

          return ACME._challengeToAuth(me, options, results, challenge, false).then(function (auth) {
            auths.push(auth);
            return ACME._setChallenge(me, options, auth).then(setNext);
          });
        });
      }

      function checkNext() {
        var auth = auths.shift();
        if (!auth) { return; }

        if (!me._canUse[auth.type] || me.skipChallengeTest) {
          // not so much "valid" as "not invalid"
          // but in this case we can't confirm either way
          validAuths.push(auth);
          return Promise.resolve();
        }

        return ACME.challengeTests[auth.type](me, auth).then(function () {
          validAuths.push(auth);
        }).then(checkNext);
      }

      function challengeNext() {
        var auth = validAuths.shift();
        if (!auth) { return; }
        return ACME._postChallenge(me, options, auth).then(challengeNext);
      }

      // First we set every challenge
      // Then we ask for each challenge to be checked
      // Doing otherwise would potentially cause us to poison our own DNS cache with misses
      return setNext().then(checkNext).then(challengeNext).then(function () {
        if (me.debug) { console.debug("[getCertificate] next.then"); }
        var validatedDomains = body.identifiers.map(function (ident) {
          return ident.value;
        });

        return ACME._finalizeOrder(me, options, validatedDomains);
      }).then(function (order) {
        if (me.debug) { console.debug('acme-v2: order was finalized'); }
        // TODO POST-as-GET
        return me.request({ method: 'GET', url: options._certificate, json: true }).then(function (resp) {
          if (me.debug) { console.debug('acme-v2: csr submitted and cert received:'); }
          // https://github.com/certbot/certbot/issues/5721
          var certsarr = ACME.splitPemChain(ACME.formatPemChain((resp.body||'')));
          //  cert, chain, fullchain, privkey, /*TODO, subject, altnames, issuedAt, expiresAt */
          var certs = {
            expires: order.expires
          , identifiers: order.identifiers
          //, authorizations: order.authorizations
          , cert: certsarr.shift()
          //, privkey: privkeyPem
          , chain: certsarr.join('\n')
          };
          if (me.debug) { console.debug(certs); }
          return certs;
        });
      });
    });
  });
};
ACME._generateCsrWeb64 = function (me, options, validatedDomains) {
  var csr;
  if (options.csr) {
    csr = options.csr;
    // if der, convert to base64
    if ('string' !== typeof csr) { csr = Enc.bufToUrlBase64(csr); }
    // nix PEM headers, if any
    if ('-' === csr[0]) { csr = csr.split(/\n+/).slice(1, -1).join(''); }
    csr = Enc.base64ToUrlBase64(csr.trim().replace(/\s+/g, ''));
    return Promise.resolve(csr);
  }

  return ACME._importKeypair(me, options.serverKeypair || options.domainKeypair).then(function (pair) {
    return me.CSR({ jwk: pair.private, domains: validatedDomains, encoding: 'der' }).then(function (der) {
      return Enc.bufToUrlBase64(der);
    });
  });
};

ACME.create = function create(me) {
  if (!me) { me = {}; }
  // me.debug = true;
  me.challengePrefixes = ACME.challengePrefixes;
  me.Keypairs = me.Keypairs || exports.Keypairs || require('keypairs').Keypairs;
  me.CSR = me.CSR || exports.CSR || require('CSR').CSR;
  me._nonces = [];
  me._canUse = {};
  if (!me._baseUrl) {
    me._baseUrl = "";
  }
  //me.Keypairs = me.Keypairs || require('keypairs');
  //me.request = me.request || require('@root/request');
  if (!me.dns01) {
    me.dns01 = function (auth) {
      return ACME._dns01(me, auth);
    };
  }
  // backwards compat
  if (!me.dig) { me.dig = me.dns01; }
  if (!me.http01) {
    me.http01 = function (auth) {
      return ACME._http01(me, auth);
    };
  }

  if ('function' !== typeof me.request) {
    me.request = ACME._defaultRequest;
  }

  me.init = function (opts) {
    function fin(dir) {
      me._directoryUrls = dir;
      me._tos = dir.meta.termsOfService;
      return dir;
    }
    if (opts && opts.meta && opts.termsOfService) {
      return Promise.resolve(fin(opts));
    }
    if (!me.directoryUrl) { me.directoryUrl = opts; }
    if ('string' !== typeof me.directoryUrl) {
      throw new Error("you must supply either the ACME directory url as a string or an object of the ACME urls");
    }
    var p = Promise.resolve();
    if (!me.skipChallengeTest) {
      p = me.request({ url: me._baseUrl + "/api/_acme_api_/" }).then(function (resp) {
        if (resp.body.success) {
          me._canCheck['http-01'] = true;
          me._canCheck['dns-01'] = true;
        }
      }).catch(function () {
        // ignore
      });
    }
    return p.then(function () {
      return ACME._directory(me).then(function (resp) {
        return fin(resp.body);
      });
    });
  };
  me.accounts = {
    create: function (options) {
      return ACME._registerAccount(me, options);
    }
  };
  me.certificates = {
    create: function (options) {
      return ACME._getCertificate(me, options);
    }
  };
  return me;
};

// Handle nonce, signing, and request altogether
ACME._jwsRequest = function (me, bigopts) {
  return ACME._getNonce(me).then(function (nonce) {
    bigopts.protected.nonce = nonce;
    bigopts.protected.url = bigopts.url;
    // protected.alg: added by Keypairs.signJws
    if (!bigopts.protected.jwk) {
      // protected.kid must be overwritten due to ACME's interpretation of the spec
      if (!bigopts.protected.kid) { bigopts.protected.kid = bigopts.options._kid; }
    }
    return me.Keypairs.signJws(
      { jwk: bigopts.options.accountKeypair.privateKeyJwk
      , protected: bigopts.protected
      , payload: bigopts.payload
      }
    ).then(function (jws) {
      if (me.debug) { console.debug('[acme-v2] ' + bigopts.url + ':'); }
      if (me.debug) { console.debug(jws); }
      return ACME._request(me, { url: bigopts.url, json: jws });
    });
  });
};
// Handle some ACME-specific defaults
ACME._request = function (me, opts) {
  if (!opts.headers) { opts.headers = {}; }
  if (opts.json && true !== opts.json) {
    opts.headers['Content-Type'] = 'application/jose+json';
    opts.body = JSON.stringify(opts.json);
    if (!opts.method) { opts.method = 'POST'; }
  }
  return me.request(opts).then(function (resp) {
    resp = resp.toJSON();
    if (resp.headers['replay-nonce']) {
      ACME._setNonce(me, resp.headers['replay-nonce']);
    }
    return resp;
  });
};
// A very generic, swappable request lib
ACME._defaultRequest = function (opts) {
  // Note: normally we'd have to supply a User-Agent string, but not here in a browser
  if (!opts.headers) { opts.headers = {}; }
  if (opts.json) {
    opts.headers.Accept = 'application/json';
    if (true !== opts.json) { opts.body = JSON.stringify(opts.json); }
  }
  if (!opts.method) {
    opts.method = 'GET';
    if (opts.body) { opts.method = 'POST'; }
  }
  opts.cors = true;
  return window.fetch(opts.url, opts).then(function (resp) {
    var headers = {};
    var result = { statusCode: resp.status, headers: headers, toJSON: function () { return this; } };
    Array.from(resp.headers.entries()).forEach(function (h) { headers[h[0]] = h[1]; });
    if (!headers['content-type']) {
      return result;
    }
    if (/json/.test(headers['content-type'])) {
      return resp.json().then(function (json) {
        result.body = json;
        return result;
      });
    }
    return resp.text().then(function (txt) {
      result.body = txt;
      return result;
    });
  });
};

ACME._importKeypair = function (me, kp) {
  var jwk = kp.privateKeyJwk;
  var p;
  if (jwk) {
    // nix the browser jwk extras
    jwk.key_ops = undefined;
    jwk.ext = undefined;
    p = Promise.resolve({ private: jwk, public: me.Keypairs.neuter({ jwk: jwk }) });
  } else {
    p = me.Keypairs.import({ pem: kp.privateKeyPem });
  }
  return p.then(function (pair) {
    kp.privateKeyJwk = pair.private;
    kp.publicKeyJwk = pair.public;
    if (pair.public.kid) {
      pair = JSON.parse(JSON.stringify(pair));
      delete pair.public.kid;
      delete pair.private.kid;
    }
    return pair;
  });
};

/*
TODO
Per-Order State Params
      _kty
      _alg
      _finalize
      _expires
      _certificate
      _order
      _authorizations
*/

ACME._toWebsafeBase64 = function (b64) {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g,"");
};

// In v8 this is crypto random, but we're just using it for pseudorandom
ACME._prnd = function (n) {
  var rnd = '';
  while (rnd.length / 2 < n) {
    var num = Math.random().toString().substr(2);
    if (num.length % 2) {
      num = '0' + num;
    }
    var pairs = num.match(/(..?)/g);
    rnd += pairs.map(ACME._toHex).join('');
  }
  return rnd.substr(0, n*2);
};
ACME._toHex = function (pair) {
  return parseInt(pair, 10).toString(16);
};
ACME._dns01 = function (me, auth) {
  return new me.request({ url: me._baseUrl + "/api/dns/" + auth.dnsHost + "?type=TXT" }).then(function (resp) {
    var err;
    if (!resp.body || !Array.isArray(resp.body.answer)) {
      err = new Error("failed to get DNS response");
      console.error(err);
      throw err;
    }
    if (!resp.body.answer.length) {
      err = new Error("failed to get DNS answer record in response");
      console.error(err);
      throw err;
    }
    return {
      answer: resp.body.answer.map(function (ans) {
        return { data: ans.data, ttl: ans.ttl };
      })
    };
  });
};
ACME._http01 = function (me, auth) {
  var url = encodeURIComponent(auth.challengeUrl);
  return new me.request({ url: me._baseUrl + "/api/http?url=" + url }).then(function (resp) {
    return resp.body;
  });
};
ACME._removeChallenge = function (me, options, auth) {
  var challengers = options.challenges || {};
  var removeChallenge = (challengers[auth.type] && challengers[auth.type].remove) || options.removeChallenge;
  if (1 === removeChallenge.length) {
    removeChallenge(auth).then(function () {}, function () {});
  } else if (2 === removeChallenge.length) {
    removeChallenge(auth, function (err) { return err; });
  } else {
    if (!ACME._removeChallengeWarn) {
      console.warn("Please update to acme-v2 removeChallenge(options) <Promise> or removeChallenge(options, cb).");
      console.warn("The API has been changed for compatibility with all ACME / Let's Encrypt challenge types.");
      ACME._removeChallengeWarn = true;
    }
    removeChallenge(auth.request.identifier, auth.token, function () {});
  }
};

Enc.bufToUrlBase64 = function (u8) {
  return Enc.bufToBase64(u8)
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};
Enc.bufToBase64 = function (u8) {
  var bin = '';
  u8.forEach(function (i) {
    bin += String.fromCharCode(i);
  });
  return btoa(bin);
};

Crypto._sha = function (sha, str) {
  var encoder = new TextEncoder();
  var data = encoder.encode(str);
  sha = 'SHA-' + sha.replace(/^sha-?/i, '');
  return window.crypto.subtle.digest(sha, data).then(function (hash) {
    return Enc.bufToUrlBase64(new Uint8Array(hash));
  });
};

}('undefined' === typeof window ? module.exports : window));

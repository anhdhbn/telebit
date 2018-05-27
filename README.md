# Telebit Remote

Because friends don't let friends localhost&trade;

| Sponsored by [ppl](https://ppl.family)
| **Telebit Remote**
| [Telebit Relay](https://git.coolaj86.com/coolaj86/telebitd.js)
|

Break out of localhost.
-----

If you need to get bits from here to there, Telebit gets the job done.

Install Telebit Remote on any device - your laptop, raspberry pi, whatever -
and now you can access that device from anywhere, even securely in a web browser.

How does it work?
It's a net server that uses a relay to allow multiplexed incoming connections
on any external port.

Features
--------

* [x] Show your mom the web app you're working on
* [x] Access your Raspberry Pi from behind a firewall
* [x] Watch Netflix without region restrictions while traveling
* [x] SSH over HTTPS on networks with restricted ports or protocols
* [x] Access your wife's laptop while she's on a flight

<!-- TODO use some imagery -->

Install
=======

Mac & Linux
-----------

Open Terminal and run this install script:

```
curl -fsSL https://get.telebit.cloud/ | bash
```

Of course, feel free to inspect the install script before you run it.

This will install Telebit Remote to `/opt/telebit` and
put a symlink to `/opt/telebit/bin/telebit` in `/usr/local/bin/telebit`
for convenience.

You can customize the installation:

```bash
export NODEJS_VER=v10.2
export TELEBIT_PATH=/opt/telebit
curl -fsSL https://get.telebit.cloud/
```

That will change the bundled version of node.js is bundled with Telebit Relay
and the path to which Telebit Relay installs.

You can get rid of the tos + email and server domain name prompts by providing them right away:

```bash
curl -fsSL https://get.telebit.cloud/ | bash -- jon@example.com example.com telebit.example.com xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Windows & Node.js
-----------------

1. Install [node.js](https://nodejs.org)
2. Open _Node.js_
2. Run the command `npm install -g telebit`

**Note**: Use node.js v8.x or v10.x

There is [a bug](https://github.com/nodejs/node/issues/20241) in node v9.x that causes telebit to crash.

Usage
====

```bash
telebit --config /etc/telebit/telebit.yml
```

Options

`/etc/telebit/telebit.yml:`
```
email: 'jon@example.com'          # must be valid (for certificate recovery and security alerts)
agree_tos: true                   # agree to the Telebit, Greenlock, and Let's Encrypt TOSes
community_member: true            # receive infrequent relevant but non-critical updates
telemetry: true                   # contribute to project telemetric data
secret: ''                        # JWT authorization secret. Generate like so:
                                  #   node -e "console.log(crypto.randomBytes(16).toString('hex'))"
remote_options:
  https_redirect: false           # don't redirect http to https remotely
servernames:                      # servernames that will be forwarded here
  - example.com
local_ports:                      # ports to forward
  3000: 'http'
  8443: 'https'
  5050: true
```

<!--
```
redirect:
  example.com/foo: /bar
  '*': whatever.com/
vhost:                            # securely serve local sites from this path (or false)
  example.com: /srv/example.com   # (uses template string, i.e. /var/www/:hostname/public)
  '*': /srv/www/:hostname
reverse_proxy: /srv/
  example.com: 3000
  '*': 3000
terminated_tls:
  'example.com': 3000
  '*': 3000
sni_forward:
  'example.com': 8443
  '*': 8443
port_forward:
  2020: 2020
  '*': 4040

greenlock:
  store: le-store-certbot         # certificate storage plugin
  config_dir: /etc/acme           # directory for ssl certificates
```
-->

Using Telebit with node.js
--------------------------

Telebit has two parts:
  * the local server
  * the relay service

This repository is for the local server, which you run on the computer or device that you would like to access.

This is the portion that runs on your computer
You will need both Telebit (this, telebit.js) and a Telebit Relay
(such as [telebitd.js](https://git.coolaj86.com/coolaj86/telebitd.js)).

You can **integrate telebit.js into your existing codebase** or use the **standalone CLI**.

* CLI
* Node.js Library
* Browser Library

Telebit CLI
-----------

Installs as `stunnel.js` with the alias `jstunnel`
(for those that regularly use `stunnel` but still like commandline completion).

### Install

```bash
npm install -g telebit
```

```bash
npm install -g 'git+https://git@git.coolaj86.com/coolaj86/tunnel-client.js.git#v1'
```

Or if you want to bow down to the kings of the centralized dictator-net:

How to use `stunnel.js` with your own instance of `stunneld.js`:

```bash
stunnel.js \
  --locals <<external domain name>> \
  --stunneld wss://<<tunnel domain>>:<<tunnel port>> \
  --secret <<128-bit hex key>>
```

```bash
stunnel.js --locals john.example.com --stunneld wss://tunnel.example.com:443 --secret abc123
```

```bash
stunnel.js \
  --locals <<protocol>>:<<external domain name>>:<<local port>> \
  --stunneld wss://<<tunnel domain>>:<<tunnel port>> \
  --secret <<128-bit hex key>>
```

```bash
stunnel.js \
  --locals http:john.example.com:3000,https:john.example.com \
  --stunneld wss://tunnel.example.com:443 \
  --secret abc123
```

```
--secret          the same secret used by stunneld (used for authentication)
--locals          comma separated list of <proto>:<servername>:<port> to which
                  incoming http and https should be forwarded
--stunneld        the domain or ip address at which you are running stunneld.js
-k, --insecure    ignore invalid ssl certificates from stunneld
```

Node.js Library
=======

### Example

```javascript
var stunnel = require('stunnel');

stunnel.connect({
  stunneld: 'wss://tunnel.example.com'
, token: '...'
, locals: [
    // defaults to sending http to local port 80 and https to local port 443
    { hostname: 'doe.net' }

    // sends both http and https to local port 3000 (httpolyglot)
  , { protocol: 'https', hostname: 'john.doe.net', port: 3000 }

    // send http to local port 4080 and https to local port 8443
  , { protocol: 'https', hostname: 'jane.doe.net', port: 4080 }
  , { protocol: 'https', hostname: 'jane.doe.net', port: 8443 }
  ]

, net: require('net')
, insecure: false
});
```

* You can get sneaky with `net` and provide a `createConnection` that returns a `stream.Duplex`.

### Token

```javascript
var tokenData = { domains: [ 'doe.net', 'john.doe.net', 'jane.doe.net' ] }
var secret = 'shhhhh';
var token = jwt.sign(tokenData, secret);
```

### net

Let's say you want to handle http requests in-process
or decrypt https before passing it to the local http handler.

You'll need to create a pair of streams to connect between the
local handler and the tunnel handler.

You could do a little magic like this:

```js
stunnel.connect({
  // ...
, net: {
  createConnection: function (info, cb) {
    // data is the hello packet / first chunk
    // info = { data, servername, port, host, remoteAddress: { family, address, port } }

    var streamPair = require('stream-pair');

    // here "reader" means the socket that looks like the connection being accepted
    var writer = streamPair.create();
    // here "writer" means the remote-looking part of the socket that driving the connection
    var reader = writer.other;
    // duplex = { write, push, end, events: [ 'readable', 'data', 'error', 'end' ] };

    reader.remoteFamily = info.remoteFamily;
    reader.remoteAddress = info.remoteAddress;
    reader.remotePort = info.remotePort;

    // socket.local{Family,Address,Port}
    reader.localFamily = 'IPv4';
    reader.localAddress = '127.0.01';
    reader.localPort = info.port;

    httpsServer.emit('connection', reader);

    if (cb) {
      process.nextTick(cb);
    }

    return writer;
  }
});
```

Browser Library
=======

This is implemented with websockets, so you should be able to

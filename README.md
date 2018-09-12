# Telebit&trade; Remote

Because friends don't let friends localhost&trade;

| Sponsored by [ppl](https://ppl.family)
| **Telebit Remote**
| [Telebit Relay](https://git.coolaj86.com/coolaj86/telebit-relay.js)
| [sclient](https://telebit.cloud/sclient)
|

<img align="center" src="https://git.coolaj86.com/coolaj86/telebit.js/raw/branch/master/usr/share/docs/terminal-example-1.png">

Break out of localhost.
=======

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

Examples
========

You do this:

    curl -fsSL https://get.telebit.io | bash

You get this:

    ~/telebit http 3000
    > Forwarding lucky-duck-42.telebit.cloud => localhost:3000

    ~/telebit http ~/sites/example.com/
    > Serving ~/sites/example.com/ as lucky-duck-42.telebit.cloud

And this:

    ~/telebit tcp 5050
    > Forwarding telebit.cloud:1337 => localhost:5050

And even this:

    ~/telebit ssh auto
    > Forwarding ssh telebit.cloud -p 1337 => localhost:22
    > Forwarding ssh+https (openssl proxy) => localhost:22

No privileged ports. No sudo. End-to-end encryption.

Fastest way to test a site, share a file, and pair over ssh.

Install
=======

Mac & Linux
-----------

Open Terminal and run this install script:

```
curl -fsSL https://get.telebit.io | bash
```

<!--
```
bash <( curl -fsSL https://get.telebit.io )
```

<small>
Note: **fish**, **zsh**, and other **non-bash** users should do this

```
curl -fsSL https://get.telebit.io/ > get.sh; bash get.sh
```
</small>
-->

What does the installer do?

  * install Telebit Remote to `~/Applications/telebit/`
  * symlink the executable to `~/telebit` for convenience
  * create the appropriate system launcher file
    * `/etc/systemd/system/telebit.service`
    * `~/Library/LaunchAgents/cloud.telebit.remote.plist`
  * create local user config
    * `~/.config/telebit/telebit.yml`
    * `~/.local/share/telebit`

Of course, feel free to inspect it before you run it: `curl -fsSL https://get.telebit.io`

**You can customize the installation**:

```bash
export NODEJS_VER=v10.2                   # v10.2 is tested working, but we can test other versions
export TELEBIT_VERSION=master             # git tag or branch to install from
export TELEBIT_USERSPACE=no               # install as a system service (launchd, systemd only)
export TELEBIT_PATH=/opt/telebit
export TELEBIT_USER=telebit
export TELEBIT_GROUP=telebit
curl -fsSL https://get.telebit.io/ | bash
```

That will change the bundled version of node.js is bundled with Telebit Relay
and the path to which Telebit Relay installs.

Windows & Node.js
-----------------

1. Install [node.js](https://nodejs.org)
2. Open _Node.js_
2. Run the command `npm install -g telebit`
2. Copy the example daemon conifg to your user folder `.config/telebit/telebitd.yml` (such as `/Users/John/.config/telebit/telebitd.yml`)
2. Copy the example remote conifg to your user folder `.config/telebit/telebit.yml` (such as `/Users/John/.config/telebit/telebit.yml`)
2. Change the email address
2. Run `npx telebit init` and follow the instructions
2. Run `npx telebit list`

**Note**: Use node.js **v10.2.1**

(there are specific bugs in each of
v8.x,
[v9.x](https://github.com/nodejs/node/issues/20241),
v10.0,
and v10.3
that each cause telebit to crash)

Remote Usage
============

```
# commands
telebit <command>

# domain and port control
telebit <service> <handler> [servername] [options ...]
```

Examples:

```
telebit status                          # whether enabled or disabled
telebit enable                          # disallow incoming connections
telebit disable                         # allow incoming connections
telebit restart                         # kill daemon and allow system launcher to restart it

telebit list                            # list rules for servernames and ports

                       ################
                       #     HTTP     #
                       ################

telebit http <handler> [servername] [opts]

telebit http none                       # remove all https handlers
telebit http 3000                       # forward all https traffic to port 3000
telebit http /module/path               # load a node module to handle all https traffic

telebit http none example.com           # remove https handler from example.com
telebit http 3001 example.com           # forward https traffic for example.com to port 3001
telebit http /module/path example.com   # forward https traffic for example.com to port 3001


                       ################
                       #     TCP      #
                       ################

telebit tcp <handler> [servername] [opts]

telebit tcp none                        # remove all tcp handlers
telebit tcp 5050                        # forward all tcp to port 5050
telebit tcp /module/path                # handle all tcp with a node module

telebit tcp none 6565                   # remove tcp handler from external port 6565
telebit tcp 5050 6565                   # forward external port 6565 to local 5050
telebit tcp /module/path 6565           # handle external port 6565 with a node module

telebit ssh disable                     # disable ssh access
telebit ssh 22                          # port-forward all ssh connections to port 22

telebit save                            # save http and tcp configuration changes
```

### Using SSH

SSH over HTTPS
```
ssh -o ProxyCommand='openssl s_client -connect %h:443 -servername %h -quiet' lucky-duck-42.telebit.cloud
```

SSH over non-standard port
```
ssh lucky-duck-42.telebit.cloud -p 3031
```

Daemon Usage (non-global)
============

```bash
~/Applications/bin/node ~/Applications/bin/telebitd.js --config ~/.config/telebit/telebitd.yml
```

Options

`~/.config/telebit/telebitd.yml:`
```
email: 'jon@example.com'          # must be valid (for certificate recovery and security alerts)
agree_tos: true                   # agree to the Telebit, Greenlock, and Let's Encrypt TOSes
relay: wss://telebit.cloud        # a Telebit Relay instance
community_member: true            # receive infrequent relevant but non-critical updates
telemetry: true                   # contribute to project telemetric data
secret: ''                        # Secret with which to sign Tokens for authorization
#token: ''                         # A signed Token for authorization
ssh_auto: 22                      # forward ssh-looking packets, from any connection, to port 22
servernames:                      # servernames that will be forwarded here
  example.com: {}
```

Choosing A Relay
================

You can create a free or paid account at <https://telebit.cloud>
or you can run [Telebit Relay](https://git.coolaj86.com/coolaj86/telebitd.js)
open source on a VPS (Vultr, Digital Ocean)
or your Raspberry Pi at home (with port-forwarding).

Only connect to Telebit Relays that you trust.

<!--
## Important Defaults

The default behaviors work great for newbies,
but can be confusing or annoying to experienced networking veterans.

See the **Advanced Configuration** section below for more details.

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
terminate_tls:
  'example.com': 3000
  '*': 3000
tls:
  'example.com': 8443
  '*': 8443
port_forward:
  2020: 2020
  '*': 4040

greenlock:
  store: le-store-certbot         # certificate storage plugin
  config_dir: etc/acme            # directory for ssl certificates
```

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

Installs Telebit Remote as `telebit`
(for those that regularly use `telebit` but still like commandline completion).

### Install

```bash
npm install -g telebit
```

```bash
npm install -g 'https://git.coolaj86.com/coolaj86/telebit.js.git#v1'
```

Or if you want to bow down to the kings of the centralized dictator-net:

How to use Telebit Remote with your own instance of Telebit Relay:

```bash
telebitd \
  --locals <<external domain name>> \
  --relay wss://<<tunnel domain>>:<<tunnel port>> \
  --secret <<128-bit hex key>>
```

```bash
telebitd --locals john.example.com --relay wss://tunnel.example.com:443 --secret abc123
```

```bash
telebitd \
  --locals <<protocol>>:<<external domain name>>:<<local port>> \
  --relay wss://<<tunnel domain>>:<<tunnel port>> \
  --secret <<128-bit hex key>>
```

```bash
telebitd \
  --locals http:john.example.com:3000,https:john.example.com \
  --relay wss://tunnel.example.com:443 \
  --secret abc123
```

```
--secret          the same secret used by the Telebit Relay (for authentication)
--locals          comma separated list of <proto>:<servername>:<port> to which
                  incoming http and https should be forwarded
--relay        the domain or ip address at which you are running Telebit Relay
-k, --insecure    ignore invalid ssl certificates from relay
```

Node.js Library
=======

### Example

```javascript
var Telebit = require('telebit');

Telebit.connect({
  relay: 'wss://tunnel.example.com'
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
Telebit.connect({
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

Advanced Configuration
======================

There is no configuration for these yet,
but we believe it is important to add them.

### http to https

By default http connections are redirected to https.

If for some reason you need raw access to unencrypted http
you'll need to set it manually.

Proposed configuration:

```
insecure_http:
  proxy: true         # add X-Forward-* headers
  port: 3000          # connect to port 3000
  hostnames:          # only these hostnames will be left insecure
    - example.com
```

**Note**: In the future unencrypted connections will only be allowed
on self-hosted and paid-hosted Telebit Relays. We don't want the
legal liability of transmitting your data in the clear, thanks. :p

### TLS Termination (Secure SSL decryption)

Telebit is designed for end-to-end security.

For convenience the Telebit Remote client uses Greenlock to handle all
HTTPS connections and then connect to a local webserver with the correct proxy headers.

However, if you want to handle the encrypted connection directly, you can:

Proposed Configuration:

```
tls:
  example.com: 3000   # specific servername
  '*': 3000           # all servernames
  '!': 3000           # missing servername
```

TODO
====

Install for user
  * https://wiki.archlinux.org/index.php/Systemd/User
  * https://developer.apple.com/library/content/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html
    * `sudo launchctl load -w ~/Library/LaunchAgents/cloud.telebit.remote`
    * https://serverfault.com/questions/194832/how-to-start-stop-restart-launchd-services-from-the-command-line
-->

Check Logs
==========

**Linux**:

```
SYSTEMD_LOG_LEVEL=debug journalctl -xef --user-unit=telebit
```

**macOS**:

```
tail -f ~/local/share/telebit/var/log/info.log
```

```
tail -f ~/.local/share/telebit/var/log/error.log
```

Uninstall
=======

**Linux**:

```
systemctl --user disable telebit; systemctl --user stop telebit
rm -f ~/.config/systemd/user/telebit.service
rm -rf ~/telebit ~/Applications/telebit
rm -rf ~/.config/telebit ~/.local/share/telebit
```

**macOS**:

```
launchctl unload -w ~/Library/LaunchAgents/cloud.telebit.remote.plist
rm -f ~/Library/LaunchAgents/cloud.telebit.remote.plist
rm -rf ~/telebit ~/Applications/telebit
rm -rf ~/.config/telebit ~/.local/share/telebit
```

Browser Library
=======

This is implemented with websockets, so you should be able to

LICENSE
=======

Copyright 2016-2018+ AJ ONeal

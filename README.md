# stunnel.js

Works in combination with [stunneld.js](https://github.com/Daplie/node-tunnel-server)
to allow you to serve http and https from provide a secure tunnelA paired client for our node tunnel server

CLI
===

Installs as `stunnel.js` with the alias `jstunnel`
(for those that regularly use `stunnel` but still like commandline completion).

### Install

```bash
npm install -g stunnel
```

### Advanced Usage

How to use `stunnel.js` with your own instance of `stunneld.js`:

```bash
stunnel.js --locals http:john.example.com:3000,https:john.example.com --stunneld https://tunnel.example.com:443 --secret abc123
```

```
--secret          the same secret used by stunneld (used for authentication)
--locals          comma separated list of <proto>:<servername>:<port> to which
                  incoming http and https should be forwarded
--stunneld        the domain or ip address at which you are running stunneld.js
-k, --insecure    ignore invalid ssl certificates from stunneld
```

### Usage

**NOT YET IMPLEMENTED**

Daplie's tunneling service is not yet publicly available.

**Terms of Service**: The Software and Services shall be used for Good, not Evil.
Examples of good: education, business, pleasure. Examples of evil: crime, abuse, extortion.

```bash
stunnel.js --agree-tos --email john@example.com --locals http:john.example.com:4080,https:john.example.com:8443
```

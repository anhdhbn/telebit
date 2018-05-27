TODO

  * [*] Work with Secure WebSockets
  * [ ] Hijack HTTPS connection directly (without WebSockets)
  * [p] Raw TCP (for transporting https once, not twice) (partial)
  * [ ] Let's Encrypt Support (for connecting to a plain http server locally)

A pure-JavaScript tunnel client for http and https similar to localtunnel.me, but uses TLS (SSL) with ServerName Indication (SNI) over https to work even in harsh network conditions such as in student dorms and behind HOAs, corporate firewalls, public libraries, airports, airplanes, etc. Can also tunnel tls and plain tcp.

### Usage with OAuth3.org

The OAuth3.org tunnel service is in Beta.

**Terms of Service**: The Software and Services shall be used for Good, not Evil.
Examples of good: education, business, pleasure. Examples of evil: crime, abuse, extortion.

```bash
stunnel.js --agree-tos --email john@example.com --locals http:*:4080,https:*:8443 --device
```

```bash
stunnel.js \
  --agree-tos --email <EMAIL> \
  --locals <List of <SCHEME>:<EXTERNAL_DOMAINNAME>:<INTERNAL_PORT>> \
  --device [HOSTNAME] \
  --domains [Comma-separated list of domains to attach to device] \
  --oauth3-url <Tunnel Service OAuth3 URL>
```

### Advanced Usage (DIY)



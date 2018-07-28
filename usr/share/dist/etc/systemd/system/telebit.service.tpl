# Pre-req
# sudo adduser telebit --home {TELEBIT_PATH}
# sudo mkdir -p {TELEBIT_PATH}/
# sudo chown -R {TELEBIT_USER}:{TELEBIT_GROUP} {TELEBIT_PATH}/

[Unit]
Description=Telebit Remote
Documentation=https://git.coolaj86.com/coolaj86/telebit.js/
After=network-online.target
Wants=network-online.target systemd-networkd-wait-online.service

[Service]
# Restart on crash (bad signal), and also on 'clean' failure (error exit code)
# Allow up to 3 restarts within 10 seconds
# (it's unlikely that a user or properly-running script will do this)
Restart=always
StartLimitInterval=10
StartLimitBurst=3

# User and group the process will run as
User={TELEBIT_USER}
Group={TELEBIT_GROUP}

WorkingDirectory={TELEBIT_PATH}
# custom directory cannot be set and will be the place where this exists, not the working directory
ExecStart={TELEBIT_NODE} {TELEBITD_JS} daemon --config {TELEBITD_CONFIG}
ExecReload=/bin/kill -USR1 $MAINPID

# Limit the number of file descriptors and processes; see `man systemd.exec` for more limit settings.
# Unmodified, this is not expected to use more than this.
LimitNOFILE=1048576
LimitNPROC=64

# Use private /tmp and /var/tmp, which are discarded after this stops.
PrivateTmp=true
# Use a minimal /dev
PrivateDevices=true
# Hide /home, /root, and /run/user. Nobody will steal your SSH-keys.
ProtectHome=true
# Make /usr, /boot, /etc and possibly some more folders read-only.
ProtectSystem=full
# ... except for a few because we want a place for config, logs, etc
# This merely retains r/w access rights, it does not add any new.
# Must still be writable on the host!
ReadWriteDirectories={TELEBIT_RW_DIRS}

# Note: in v231 and above ReadWritePaths has been renamed to ReadWriteDirectories
; ReadWritePaths={TELEBIT_RW_DIRS}

# The following additional security directives only work with systemd v229 or later.
# They further retrict privileges that can be gained.
# Note that you may have to add capabilities required by any plugins in use.
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true

# Caveat: Some features may need additional capabilities.
# For example an "upload" may need CAP_LEASE
; CapabilityBoundingSet=CAP_NET_BIND_SERVICE CAP_LEASE
; AmbientCapabilities=CAP_NET_BIND_SERVICE CAP_LEASE
; NoNewPrivileges=true

[Install]
# For system-level service
;WantedBy=multi-user.target
# For userspace service
WantedBy=default.target

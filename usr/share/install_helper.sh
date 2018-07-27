#!/bin/bash
#<pre><code>

# What does this do.. and why?
# (and why is it so complicated?)
#
# What this does
#
#   1. Sets some vars and asks some questions
#   2. Installs everything into a single place
#      (inculding deps like node.js, with the correct version)
#   3. Depending on OS, creates a user for the service
#   4. Depending on OS, register with system launcher
#
# Why
#
#   So that you can get a fully configured, running product,
#   with zero manual configuration in a matter of seconds -
#   and have an uninstall that's just as easy.
#
# Why so complicated?
#
#  To support nuance differences between various versions of
#  Linux, macOS, and Android, including whether it's being
#  installed with user privileges, as root, wit a system user
#  system daemon launcher, etc. Also, this is designed to be
#  reusable with many apps and services, so it's very variabled...

set -e
set -u

### http_bash exported by get.sh

TELEBIT_DEBUG=${TELEBIT_DEBUG:-}

# NOTE: On OS X logname works from a pipe, but on Linux it does not
my_logname=$(who am i </dev/tty | awk '{print $1}')
#my_logname=${my_logname:-$(logname)}
#my_logname=${my_logname:-$SUDO_USER}
if [ -n "$my_logname" ] && [ "$my_logname" != "$(id -u -n)" ]; then
  echo "WARNING:"
  echo "    You are logged in as '$(logname)' but acting as '$(id -u -n)'."
  echo "    If the installation is not successful please log in as '$(id -u -n)' directly."
  sleep 3
fi

if [ -n "${TELEBIT_DEBUG:-}" ]; then
  echo 'TELEBIT_DEBUG='${TELEBIT_DEBUG}
fi
if [ -n "${TELEBIT_PATH:-}" ]; then
  echo 'TELEBIT_PATH='${TELEBIT_PATH}
fi
if [ -n "${TELEBIT_USERSPACE:-}" ]; then
  echo 'TELEBIT_USERSPACE='${TELEBIT_USERSPACE}
fi
if [ -n "${TELEBIT_USER:-}" ]; then
  echo 'TELEBIT_USER='${TELEBIT_USER}
fi
if [ -n "${TELEBIT_GROUP:-}" ]; then
  echo 'TELEBIT_GROUP='${TELEBIT_GROUP}
fi
TELEBIT_VERSION=${TELEBIT_VERSION:-master}
TELEBIT_USERSPACE=${TELEBIT_USERSPACE:-no}
my_email=${1:-}
my_relay=${2:-}
my_servernames=${3:-}
my_secret=${4:-}

cur_user="$(id -u -n)"
TELEBIT_USER="${TELEBIT_USER:-$cur_user}"

cur_group="$(id -g -n)"
TELEBIT_GROUP="${TELEBIT_GROUP:-$cur_group}"

my_app_pkg_name="cloud.telebit.remote"
my_app="telebit"
my_daemon="telebitd"
my_bin="telebit.js"
my_name="Telebit Remote"
my_repo="telebit.js"
my_root=${my_root:-} # todo better install script
soft_sudo_cmd="sudo"
soft_sudo_cmde="sudo "
exec 3<>/dev/tty
read_cmd="read -u 3"
# TODO detect if rsync is available and use rsync -a (more portable)
rsync_cmd="cp -pPR"

set +e
my_edit=$(basename "${EDITOR:-}")
if [ -z "$my_edit" ]; then
  my_edit=$(basename "$(type -p edit)")
fi
if [ -z "$my_edit" ]; then
  my_edit=$(basename "$(type -p nano)")
fi
if [ -z "$my_edit" ]; then
  my_edit=$(basename "$(type -p vim)")
fi
if [ -z "$my_edit" ]; then
  my_edit=$(basename "$(type -p vi)")
fi
if [ -z "$my_edit" ]; then
  my_edit="nano"
fi
set -e

if [ "root" == $(whoami) ] || [ 0 == $(id -u) ]; then
  soft_sudo_cmd=" "
  soft_sudo_cmde=""
fi

echo ""

TELEBIT_REAL_PATH=${TELEBIT_PATH:-}

if [ $(id -u) -ne 0 ] && [ "$TELEBIT_USER" == "$cur_user" ]; then
  TELEBIT_USERSPACE="yes"
  if [ -z "${TELEBIT_REAL_PATH:-}" ]; then
    TELEBIT_REAL_PATH=$HOME/Applications/$my_app
  fi
else
  TELEBIT_USERSPACE="no"
  if [ -z "${TELEBIT_REAL_PATH:-}" ]; then
    TELEBIT_REAL_PATH=/opt/$my_app
  fi
fi
TELEBIT_PATH="$TELEBIT_REAL_PATH"
TELEBIT_TMP="$TELEBIT_REAL_PATH"
# this works slightly differently between bsd (macOS) and gnu mktemp
# bsd requires the Xes for templates while GNU uses them literally
my_tmp="$(mktemp -d -t telebit.XXXXXXXX)"
#TELEBIT_TMP="$my_tmp/telebit"

echo "Installing $my_name to '$TELEBIT_REAL_PATH'"
# v10.2+ has much needed networking fixes, but breaks ursa. v9.x has severe networking bugs. v8.x has working ursa, but requires tls workarounds"
NODEJS_VER="${NODEJS_VER:-v10.6}"
export NODEJS_VER
export NODE_PATH="$TELEBIT_TMP/lib/node_modules"
export NPM_CONFIG_PREFIX="$TELEBIT_TMP"
# this comes last for security
export PATH="$PATH:$TELEBIT_REAL_PATH/bin"
sleep 0.25
real_sudo_cmd=$soft_sudo_cmd
real_sudo_cmde=$soft_sudo_cmde

set +e
mkdir -p $my_tmp "$TELEBIT_REAL_PATH" "$TELEBIT_REAL_PATH/etc" "$TELEBIT_REAL_PATH/var/log" 2>/dev/null && \
  chown -R $(id -u -n):$(id -g -n) $my_tmp "$TELEBIT_REAL_PATH" 2>/dev/null
if [ $? -eq 0 ]; then
  soft_sudo_cmd=" "
  soft_sudo_cmde=""
else
  $soft_sudo_cmd mkdir -p $my_tmp "$TELEBIT_REAL_PATH" "$TELEBIT_REAL_PATH/etc" "$TELEBIT_REAL_PATH/var/log"
  $soft_sudo_cmd chown -R $(id -u -n):$(id -g -n) $my_tmp "$TELEBIT_REAL_PATH"
fi
set -e


if [ -n "${TELEBIT_DEBUG}" ]; then
  echo "  - installing node.js runtime to '$TELEBIT_REAL_PATH'..."
  http_bash https://git.coolaj86.com/coolaj86/node-installer.sh/raw/branch/master/install.sh --no-dev-deps
else
  echo -n "."
  #bash -c 'while true; do echo -n "."; sleep 2; done' 2>/dev/null &
  #_my_pid=$!
  http_bash https://git.coolaj86.com/coolaj86/node-installer.sh/raw/branch/master/install.sh --no-dev-deps >/dev/null 2>/dev/null
  #kill $_my_pid >/dev/null 2>/dev/null
fi

#
# TODO create "upgrade" script and run that instead
#

my_node="$TELEBIT_REAL_PATH/bin/node"
tmp_node="$TELEBIT_TMP/bin/node"
my_npm="$my_node $TELEBIT_TMP/bin/npm"
tmp_npm="$tmp_node $TELEBIT_TMP/bin/npm"

#https://git.coolaj86.com/coolaj86/telebit.js.git
#https://git.coolaj86.com/coolaj86/telebit.js/archive/:tree:.tar.gz
#https://git.coolaj86.com/coolaj86/telebit.js/archive/:tree:.zip
set +e
my_unzip=$(type -p unzip)
my_tar=$(type -p tar)
# TODO extract to temporary directory, configure, copy etc, replace
if [ -n "$my_unzip" ]; then
  rm -f $my_tmp/$my_app-$TELEBIT_VERSION.zip
  if [ -n "${TELEBIT_DEBUG}" ]; then
    echo "  - installing telebit zip to '$TELEBIT_REAL_PATH'"
  fi
  echo -n "."
  #bash -c 'while true; do echo -n "."; sleep 2; done' 2>/dev/null &
  #_my_pid=$!
  http_get https://git.coolaj86.com/coolaj86/$my_repo/archive/$TELEBIT_VERSION.zip $my_tmp/$my_app-$TELEBIT_VERSION.zip
  #kill $_my_pid >/dev/null 2>/dev/null
  # -o means overwrite, and there is no option to strip
  $my_unzip -o $my_tmp/$my_app-$TELEBIT_VERSION.zip -d $my_tmp/ >/dev/null
  $rsync_cmd  $my_tmp/$my_repo/* $TELEBIT_TMP/ > /dev/null
  rm -rf $my_tmp/$my_repo
elif [ -n "$my_tar" ]; then
  rm -f $my_tmp/$my_app-$TELEBIT_VERSION.tar.gz
  if [ -n "${TELEBIT_DEBUG}" ]; then
    echo "  - installing telebit tar.gz to '$TELEBIT_REAL_PATH'"
  fi
  echo -n "."
  #bash -c 'while true; do echo -n "."; sleep 2; done' 2>/dev/null &
  #_my_pid=$!
  http_get https://git.coolaj86.com/coolaj86/$my_repo/archive/$TELEBIT_VERSION.tar.gz $my_tmp/$my_app-$TELEBIT_VERSION.tar.gz
  #kill $_my_pid >/dev/null 2>/dev/null
  $my_tar -xzf $my_tmp/$my_app-$TELEBIT_VERSION.tar.gz --strip 1 -C $TELEBIT_TMP/ >/dev/null
else
  echo "Neither tar nor unzip found. Abort."
  exit 13
fi
set -e

#
# TODO create slim packages that contain all the deps on each os and cpu
#
pushd $TELEBIT_TMP >/dev/null
  if [ -n "${TELEBIT_DEBUG}" ]; then
    echo "  - installing telebit npm dependencies to '$TELEBIT_REAL_PATH'..."
  else
    echo -n "."
  fi
  $tmp_npm install >/dev/null 2>/dev/null &
  # ursa is now an entirely optional dependency for key generation
  # but very much needed on ARM devices
  $tmp_npm install ursa >/dev/null 2>/dev/null &
  tmp_npm_pid=$!
  while [ -n "$tmp_npm_pid" ]; do
    sleep 2
    echo -n "."
    kill -s 0 $tmp_npm_pid >/dev/null 2>/dev/null || tmp_npm_pid=""
  done
popd >/dev/null

if [ -n "${TELEBIT_DEBUG}" ]; then
  echo "  - configuring telebit..."
  echo ""
fi

###############################################
#
# TODO convert to node script
#
# Now that node is installed and the telebit
# packeage is downloaded, everything can be
# run from node, except things requiring sudo
#
###############################################

# telebit remote
echo '#!/bin/bash' > "$TELEBIT_TMP/bin/$my_app"
echo "$my_node $TELEBIT_REAL_PATH/bin/$my_bin "'"$@"' >> "$TELEBIT_TMP/bin/$my_app"
chmod a+x "$TELEBIT_TMP/bin/$my_app"

# telebit daemon
echo '#!/bin/bash' > "$TELEBIT_TMP/bin/$my_daemon"
echo "$my_node $TELEBIT_REAL_PATH/bin/$my_daemon.js daemon "'"$@"' >> "$TELEBIT_TMP/bin/$my_daemon"
chmod a+x "$TELEBIT_TMP/bin/$my_daemon"

# Create uninstall script based on the install script variables
cat << EOF > $TELEBIT_TMP/bin/${my_app}_uninstall
#!/bin/bash
set -x
if [ "$(type -p launchctl)" ]; then
  sudo launchctl unload -w /Library/LaunchDaemons/${my_app_pkg_name}.plist
  sudo rm -f /Library/LaunchDaemons/${my_app_pkg_name}.plist

  launchctl unload -w $HOME/Library/LaunchAgents/${my_app_pkg_name}.plist
  rm -f $HOME/Library/LaunchAgents/${my_app_pkg_name}.plist
fi
if [ "$(type -p systemctl)" ]; then
  systemctl --user disable $my_app >/dev/null
  systemctl --user stop $my_app
  rm -f $HOME/.config/systemd/user/$my_app.service

  sudo systemctl disable $my_app >/dev/null
  sudo systemctl stop $my_app
  sudo rm -f /etc/systemd/system/$my_app.service
fi
sudo rm -rf $TELEBIT_REAL_PATH /usr/local/bin/$my_app
sudo rm -rf $TELEBIT_REAL_PATH /usr/local/bin/$my_daemon
rm -rf $HOME/.config/$my_app $HOME/.local/share/$my_app
EOF
chmod a+x $TELEBIT_TMP/bin/${my_app}_uninstall

#set +e
#if type -p setcap >/dev/null 2>&1; then
#  #echo "Setting permissions to allow $my_app to run on port 80 and port 443 without sudo or root"
#  echo "    > ${real_sudo_cmde}setcap cap_net_bind_service=+ep $TELEBIT_REAL_PATH/bin/node"
#  $real_sudo_cmd setcap cap_net_bind_service=+ep $TELEBIT_REAL_PATH/bin/node
#fi
#set -e

my_skip=""
set +e
# TODO for macOS https://apple.stackexchange.com/questions/286749/how-to-add-a-user-from-the-command-line-in-macos
# TODO do stuff for groups too
# TODO add ending $
if type -p dscl >/dev/null 2>/dev/null; then
  if [ -n "$(dscl . list /users | grep ^$TELEBIT_USER)" ] && [ -n "$(dscl . list /groups | grep ^$TELEBIT_GROUP)" ]; then
    my_skip="yes"
  fi
elif [ -n "$(cat $my_root/etc/passwd | grep $TELEBIT_USER)" ] && [ -n "$(cat $my_root/etc/group | grep $TELEBIT_GROUP)" ]; then
  my_skip="yes"
fi

if [ -z "$my_skip" ]; then
  if type -p adduser >/dev/null 2>/dev/null; then
    $real_sudo_cmd adduser --home $TELEBIT_REAL_PATH --gecos '' --disabled-password $TELEBIT_USER >/dev/null 2>&1
    #TELEBIT_USER=$my_app_name
    TELEBIT_GROUP=$TELEBIT_USER
  elif [ -n "$(cat /etc/passwd | grep www-data:)" ]; then
    # Linux (Ubuntu)
    TELEBIT_USER=www-data
    TELEBIT_GROUP=www-data
  elif [ -n "$(cat /etc/passwd | grep _www:)" ]; then
    # Mac
    TELEBIT_USER=_www
    TELEBIT_GROUP=_www
  else
    # Unsure
    TELEBIT_USER=$(id -u -n) # $(whoami)
    TELEBIT_GROUP=$(id -g -n)
  fi
fi
set -e

export TELEBIT_USER
export TELEBIT_GROUP
export TELEBIT_PATH
export TELEBIT_CONFIG=$HOME/.config/$my_app/$my_app.yml
# TODO check both expected sock paths in client by default
if [ "yes" == "$TELEBIT_USERSPACE" ]; then
  TELEBIT_TMP_CONFIGD=$HOME/.config/$my_app/$my_daemon.yml
  TELEBITD_CONFIG=$HOME/.config/$my_app/$my_daemon.yml
  TELEBIT_LOG_DIR=${TELEBIT_LOG_DIR:-$HOME/.local/share/$my_app/var/log/}
  TELEBIT_SOCK_DIR=${TELEBIT_SOCK_DIR:-$HOME/.local/share/$my_app/var/run/}
  TELEBIT_SOCK=${TELEBIT_SOCK:-$HOME/.local/share/$my_app/var/run/$my_app.sock}
else
  TELEBIT_TMP_CONFIGD=$TELEBIT_TMP/etc/$my_daemon.yml
  TELEBITD_CONFIG=$TELEBIT_REAL_PATH/etc/$my_daemon.yml
  TELEBIT_LOG_DIR=${TELEBIT_LOG_DIR:-$TELEBIT_REAL_PATH/var/log/}
  TELEBIT_SOCK_DIR=${TELEBIT_SOCK_DIR:-$TELEBIT_REAL_PATH/var/run/}
  TELEBIT_SOCK=${TELEBIT_SOCK:-$TELEBIT_REAL_PATH/var/run/$my_app.sock}
fi
export TELEBITD_CONFIG
export TELEBIT_SOCK
export TELEBIT_NODE=$TELEBIT_REAL_PATH/bin/node
export TELEBIT_NPM=$TELEBIT_REAL_PATH/bin/npm
export TELEBIT_BIN=$TELEBIT_REAL_PATH/bin/telebit
export TELEBITD_BIN=$TELEBIT_REAL_PATH/bin/telebitd
export TELEBIT_JS=$TELEBIT_REAL_PATH/bin/telebit.js
export TELEBITD_JS=$TELEBIT_REAL_PATH/bin/telebitd.js
export TELEBIT_LOG_DIR
export TELEBIT_SOCK_DIR
export NODE_PATH="$TELEBIT_REAL_PATH/lib/node_modules"
export NPM_CONFIG_PREFIX="$TELEBIT_REAL_PATH"

$my_node $TELEBIT_TMP/usr/share/template-launcher.js

# TODO don't create this in TMP_PATH if it exists in TELEBIT_REAL_PATH
mkdir -p "$(dirname $TELEBIT_TMP_CONFIGD)"
if [ ! -e "$TELEBITD_CONFIG" ]; then

  echo "sock: $TELEBIT_SOCK" >> "$TELEBIT_TMP_CONFIGD"
  echo "root: $TELEBIT_REAL_PATH" >> "$TELEBIT_TMP_CONFIGD"
  cat $TELEBIT_REAL_PATH/usr/share/$my_daemon.tpl.yml >> "$TELEBIT_TMP_CONFIGD"

fi

mkdir -p "$(dirname $TELEBIT_CONFIG)"
if [ ! -e "$TELEBIT_CONFIG" ]; then

  echo "sock: $TELEBIT_SOCK" >> "$TELEBIT_CONFIG"

fi



# TODO
# Backup final directory, if it exists
# Move everything over to final directory
# Restore config files, if they exist
# rewrite system service file with real variables

# This should only affect non-USERSPACE installs
#echo "${soft_sudo_cmde}chown -R $TELEBIT_USER '$TELEBIT_REAL_PATH'
$soft_sudo_cmd mkdir -p $TELEBIT_LOG_DIR
$soft_sudo_cmd mkdir -p $TELEBIT_SOCK_DIR
$soft_sudo_cmd chown -R $TELEBIT_USER "$TELEBIT_REAL_PATH"

# $HOME/.config/systemd/user/
# %h/.config/telebit/telebit.yml
if [ -n "${TELEBIT_DEBUG}" ]; then
  echo "  - adding $my_app as a system service"
fi
# TODO detect with type -p
my_system_launcher=""
my_app_launchd_service=""
if [ -d "/Library/LaunchDaemons" ]; then
  my_system_launcher="launchd"
  my_sudo_cmde="$real_sudo_cmde"
  my_sudo_cmd="$real_sudo_cmd"


  if [ "yes" == "$TELEBIT_USERSPACE" ]; then
    my_app_launchd_service_skel="etc/skel/Library/LaunchAgents/${my_app_pkg_name}.plist"
    my_app_launchd_service="$HOME/Library/LaunchAgents/${my_app_pkg_name}.plist"
    if [ -n "${TELEBIT_DEBUG}" ]; then
      echo "    > $rsync_cmd $TELEBIT_REAL_PATH/usr/share/dist/$my_app_launchd_service $my_app_launchd_service"
    fi
    mkdir -p $HOME/Library/LaunchAgents
    $rsync_cmd "$TELEBIT_REAL_PATH/usr/share/dist/$my_app_launchd_service_skel" "$my_app_launchd_service"

    if [ -n "${TELEBIT_DEBUG}" ]; then
      echo "    > chown $(id -u -n):$(id -g -n) $my_app_launchd_service"
    fi
    chown $(id -u -n):$(id -g -n) "$my_app_launchd_service"
    my_sudo_cmd=""
    my_sudo_cmde=""

    if [ -n "${TELEBIT_DEBUG}" ]; then
      echo "    > launchctl unload -w $my_app_launchd_service >/dev/null 2>/dev/null"
      launchctl unload -w "$my_app_launchd_service" >/dev/null 2>/dev/null
    fi
  else
    my_app_launchd_service_skel="usr/share/dist/Library/LaunchDaemons/${my_app_pkg_name}.plist"
    my_app_launchd_service="$my_root/Library/LaunchDaemons/${my_app_pkg_name}.plist"
    echo "    > ${real_sudo_cmde}$rsync_cmd $TELEBIT_REAL_PATH/usr/share/dist/$my_app_launchd_service $my_app_launchd_service"
    $real_sudo_cmd $rsync_cmd "$TELEBIT_REAL_PATH/usr/share/dist/$my_app_launchd_service_skel" "$my_app_launchd_service"

    echo "    > ${real_sudo_cmde}chown root:wheel $my_app_launchd_service"
    $real_sudo_cmd chown root:wheel "$my_app_launchd_service"

    echo "    > ${real_sudo_cmde}launchctl unload -w $my_app_launchd_service >/dev/null 2>/dev/null"
    $real_sudo_cmd launchctl unload -w "$my_app_launchd_service" >/dev/null 2>/dev/null
  fi

elif [ -d "$my_root/etc/systemd/system" ]; then
  my_system_launcher="systemd"

  if [ "yes" == "$TELEBIT_USERSPACE" ]; then
    if [ -n "${TELEBIT_DEBUG}" ]; then
      echo "    > $rsync_cmd $TELEBIT_REAL_PATH/usr/share/dist/etc/skel/.config/systemd/user/$my_app.service $HOME/.config/systemd/user/$my_app.service"
    fi
    mkdir -p $HOME/.config/systemd/user
    $rsync_cmd "$TELEBIT_REAL_PATH/usr/share/dist/etc/skel/.config/systemd/user/$my_app.service" "$HOME/.config/systemd/user/$my_app.service"
  else
    echo "    > ${real_sudo_cmde}$rsync_cmd $TELEBIT_REAL_PATH/usr/share/dist/etc/systemd/system/$my_app.service /etc/systemd/system/$my_app.service"
    $real_sudo_cmd $rsync_cmd "$TELEBIT_REAL_PATH/usr/share/dist/etc/systemd/system/$my_app.service" "/etc/systemd/system/$my_app.service"
  fi
fi

sleep 1

###############################
# Actually Launch the Service #
###############################
if [ -n "${TELEBIT_DEBUG}" ]; then
  echo ""
fi
if [ "launchd" == "$my_system_launcher" ]; then

  if [ "yes" == "$TELEBIT_USERSPACE" ]; then
    if [ -n "${TELEBIT_DEBUG}" ]; then
      echo "  > launchctl load -w $my_app_launchd_service"
    else
      echo -n "."
    fi
    launchctl load -w "$my_app_launchd_service"
  else
    echo "  > ${real_sudo_cmde}launchctl load -w $my_app_launchd_service"
    $real_sudo_cmd launchctl load -w "$my_app_launchd_service"
  fi
  sleep 2; # give it time to start

elif [ "systemd" == "$my_system_launcher" ]; then

  if [ "yes" == "$TELEBIT_USERSPACE" ]; then
    # https://wiki.archlinux.org/index.php/Systemd/User
    # sudo loginctl enable-linger username

    if [ -n "${TELEBIT_DEBUG}" ]; then
      echo "    > systemctl --user enable $my_app"
    else
      echo -n "."
    fi
    systemctl --user daemon-reload
    # enable also puts success output to stderr... why?
    systemctl --user enable $my_app >/dev/null 2>/dev/null
    #echo "    > systemctl --user enable systemd-tmpfiles-setup.service systemd-tmpfiles-clean.timer"
    #systemctl --user enable systemd-tmpfiles-setup.service systemd-tmpfiles-clean.timer
    if [ -n "${TELEBIT_DEBUG}" ]; then
      echo "    > systemctl --user start $my_app"
    fi
    systemctl --user stop $my_app >/dev/null 2>/dev/null
    systemctl --user start $my_app >/dev/null
    sleep 2; # give it time to start
    _is_running=$(systemctl --user status --no-pager $my_app 2>/dev/null | grep "active.*running")
    if [ -z "$_is_running" ]; then
      echo "Something went wrong:"
      systemctl --user status --no-pager $my_app
      exit 1
    fi
    echo -n "."
  else

    $real_sudo_cmd systemctl daemon-reload
    echo "    > ${real_sudo_cmde}systemctl enable $my_app"
    $real_sudo_cmd systemctl enable $my_app >/dev/null
    echo "    > ${real_sudo_cmde}systemctl start $my_app"
    $real_sudo_cmd systemctl daemon-reload
    $real_sudo_cmd systemctl restart $my_app
    sleep 2; # give it time to start
    $real_sudo_cmd systemctl status --no-pager $my_app
  fi

else

  echo "Run the service manually (we couldn't detect your system service to do that automatically):"
  echo ""
  echo "    $TELEBITD_BIN --config $TELEBITD_CONFIG"
  echo "    ~/$my_app --config $TELEBIT_CONFIG"

fi

# NOTE: ln -sf *should* replace an existing link... but sometimes it doesn't, hence rm -f
if [ "yes" == "$TELEBIT_USERSPACE" ]; then
  if [ -n "${TELEBIT_DEBUG}" ]; then
    echo "    > ${real_sudo_cmde}ln -sf $TELEBIT_REAL_PATH/bin/$my_app /usr/local/bin/$my_app"
  fi
  rm -f /usr/local/bin/$my_app 2>/dev/null || true
  ln -sf $TELEBIT_REAL_PATH/bin/$my_app /usr/local/bin/$my_app 2>/dev/null || true
else
  echo "    > ${real_sudo_cmde}ln -sf $TELEBIT_REAL_PATH/bin/$my_app /usr/local/bin/$my_app"
  rm -f /usr/local/bin/$my_app 2>/dev/null || \
    $real_sudo_cmd rm -f /usr/local/bin/$my_app
  ln -sf $TELEBIT_REAL_PATH/bin/$my_app /usr/local/bin/$my_app 2>/dev/null || \
    $real_sudo_cmd ln -sf $TELEBIT_REAL_PATH/bin/$my_app /usr/local/bin/$my_app
  # telebitd
  echo "    > ${real_sudo_cmde}ln -sf $TELEBIT_REAL_PATH/bin/$my_daemon /usr/local/bin/$my_daemon"
  rm -f $TELEBIT_REAL_PATH/bin/$my_daemon || $real_sudo_cmd rm -f $TELEBIT_REAL_PATH/bin/$my_daemon
  ln -sf $TELEBIT_REAL_PATH/bin/$my_daemon /usr/local/bin/$my_daemon || \
    $real_sudo_cmd ln -sf $TELEBIT_REAL_PATH/bin/$my_daemon /usr/local/bin/$my_daemon
fi
rm -f $HOME/$my_app; ln -s $TELEBIT_REAL_PATH/bin/$my_app $HOME/


if [ -n "${TELEBIT_DEBUG}" ]; then
  echo "  > telebit init --tty"
  echo ""
fi
sleep 0.25

echo ""
$TELEBIT_REAL_PATH/bin/node $TELEBIT_REAL_PATH/bin/telebit.js init --tty

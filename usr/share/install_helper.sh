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

# hack to allow calling script to finish before this executes
sleep 0.1

set -e
set -u

### http_bash exported by get.sh

my_email=${1:-}
my_relay=${2:-}
my_servernames=${3:-}
my_secret=${4:-}
my_user="telebit"
my_app_pkg_name="cloud.telebit.remote"
my_app="telebit"
my_bin="telebit.js"
my_name="Telebit Remote"
my_repo="telebit.js"
my_root=${my_root:-} # todo better install script
sudo_cmd="sudo"
exec 3<>/dev/tty
read_cmd="read -u 3"
# TODO detect if rsync is available and use rsync -a (more portable)
rsync_cmd="cp -pPR"

if [ "root" == $(whoami) || 0 == $(id -u) ]; then
  sudo_cmd=" "
fi

if [ -z "${my_email}" ]; then
  echo ""
  echo ""
  echo "Telebit uses Greenlock for free automated ssl through Let's Encrypt."
  echo ""
  echo "To accept the Terms of Service for Telebit, Greenlock and Let's Encrypt,"
  echo "please enter your email."
  echo ""
  $read_cmd -p "email: " my_email
  echo ""
  # UX - just want a smooth transition
  sleep 0.5
fi

if [ -z "${my_relay}" ]; then
  echo "What self-hosted relay will you be using?"
  #echo "What relay will you be using? (press enter for default)"
  echo ""
  #$read_cmd -p "relay [default: wss://www.telebit.cloud]: " my_relay
  $read_cmd -p "relay: " my_relay
  echo ""
  my_relay=${2:-wss://www.telebit.cloud}
  # UX - just want a smooth transition
  sleep 0.5
fi

if [ -z "${my_servernames}" ]; then
  #echo "What servername(s) will you be relaying here? (press enter for default)"
  echo "What servername(s) will you be relaying here?"
  echo ""
  #$read_cmd -p "domain [default: <random>.telebit.cloud]: " my_servernames
  $read_cmd -p "domain: " my_servernames
  echo ""
  # UX - just want a smooth transition
  sleep 0.5
fi

if [ -z "${my_secret}" ]; then
  #echo "What's your authorization for the relay server? (press enter for default)"
  echo "What's your authorization for the relay server?"
  echo ""
  #$read_cmd -p "auth [default: new account]: " my_secret
  $read_cmd -p "secret: " my_secret
  echo ""
  # UX - just want a smooth transition
  sleep 0.5
fi

echo ""

if [ -z "${TELEBIT_PATH:-}" ]; then
  echo 'TELEBIT_PATH="'${TELEBIT_PATH:-}'"'
  TELEBIT_PATH=/opt/$my_app
fi

echo "Installing $my_name to '$TELEBIT_PATH'"

echo "Installing node.js dependencies into '$TELEBIT_PATH'"
# v10.2+ has much needed networking fixes, but breaks ursa. v9.x has severe networking bugs. v8.x has working ursa, but requires tls workarounds"
NODEJS_VER="${NODEJS_VER:-v10}"
export NODEJS_VER
export NODE_PATH="$TELEBIT_PATH/lib/node_modules"
export NPM_CONFIG_PREFIX="$TELEBIT_PATH"
export PATH="$TELEBIT_PATH/bin:$PATH"
sleep 0.5
echo "(your password may be required to complete installation)"
http_bash https://git.coolaj86.com/coolaj86/node-installer.sh/raw/branch/master/install.sh --no-dev-deps >/dev/null 2>/dev/null

my_tree="telebit" # my_branch
my_node="$TELEBIT_PATH/bin/node"
my_npm="$my_node $TELEBIT_PATH/bin/npm"
my_tmp="$(mktemp -d)"
mkdir -p $my_tmp

echo "$sudo_cmd mkdir -p '$TELEBIT_PATH'"
$sudo_cmd mkdir -p "$TELEBIT_PATH"
$sudo_cmd mkdir -p "$TELEBIT_PATH/etc"
$sudo_cmd mkdir -p "$TELEBIT_PATH/var/log"
$sudo_cmd chown -R $(id -u -n):$(id -g -n) "$TELEBIT_PATH"
echo "$sudo_cmd mkdir -p '/etc/$my_app/'"
$sudo_cmd mkdir -p "/etc/$my_app/"
$sudo_cmd chown $(id -u -n):$(id -g -n) "/etc/$my_app/"

#https://git.coolaj86.com/coolaj86/telebit.js.git
#https://git.coolaj86.com/coolaj86/telebit.js/archive/:tree:.tar.gz
#https://git.coolaj86.com/coolaj86/telebit.js/archive/:tree:.zip
set +e
my_unzip=$(type -p unzip)
my_tar=$(type -p tar)
if [ -n "$my_unzip" ]; then
  rm -f $my_tmp/$my_app-$my_tree.zip
  http_get https://git.coolaj86.com/coolaj86/$my_repo/archive/$my_tree.zip $my_tmp/$my_app-$my_tree.zip
  # -o means overwrite, and there is no option to strip
  $my_unzip -o $my_tmp/$my_app-$my_tree.zip -d $TELEBIT_PATH/ > /dev/null 2>&1
  $rsync_cmd  $TELEBIT_PATH/$my_repo/* $TELEBIT_PATH/ > /dev/null
  rm -rf $TELEBIT_PATH/$my_bin
elif [ -n "$my_tar" ]; then
  rm -f $my_tmp/$my_app-$my_tree.tar.gz
  http_get https://git.coolaj86.com/coolaj86/$my_repo/archive/$my_tree.tar.gz $my_tmp/$my_app-$my_tree.tar.gz
  ls -lah $my_tmp/$my_app-$my_tree.tar.gz
  $my_tar -xzf $my_tmp/$my_app-$my_tree.tar.gz --strip 1 -C $TELEBIT_PATH/
else
  echo "Neither tar nor unzip found. Abort."
  exit 13
fi
set -e

pushd $TELEBIT_PATH >/dev/null
  $my_npm install >/dev/null 2>/dev/null
popd >/dev/null

cat << EOF > $TELEBIT_PATH/bin/$my_app
#!/bin/bash
$my_node $TELEBIT_PATH/bin/$my_bin
EOF
chmod a+x $TELEBIT_PATH/bin/$my_app
echo "$sudo_cmd ln -sf $TELEBIT_PATH/bin/$my_app /usr/local/bin/$my_app"
$sudo_cmd ln -sf $TELEBIT_PATH/bin/$my_app /usr/local/bin/$my_app

set +e
if type -p setcap >/dev/null 2>&1; then
  #echo "Setting permissions to allow $my_app to run on port 80 and port 443 without sudo or root"
  echo "$sudo_cmd setcap cap_net_bind_service=+ep $TELEBIT_PATH/bin/node"
  $sudo_cmd setcap cap_net_bind_service=+ep $TELEBIT_PATH/bin/node
fi
set -e

set +e
# TODO for macOS https://apple.stackexchange.com/questions/286749/how-to-add-a-user-from-the-command-line-in-macos
if type -p adduser >/dev/null 2>/dev/null; then
  if [ -z "$(cat $my_root/etc/passwd | grep $my_user)" ]; then
    $sudo_cmd adduser --home $TELEBIT_PATH --gecos '' --disabled-password $my_user >/dev/null 2>&1
  fi
  #my_user=$my_app_name
  my_group=$my_user
elif [ -n "$(cat /etc/passwd | grep www-data:)" ]; then
  # Linux (Ubuntu)
  my_user=www-data
  my_group=www-data
elif [ -n "$(cat /etc/passwd | grep _www:)" ]; then
  # Mac
  my_user=_www
  my_group=_www
else
  # Unsure
  my_user=$(id -u -n) # $(whoami)
  my_group=$(id -g -n)
fi
set -e

# TODO don't create this in TMP_PATH if it exists in TELEBIT_PATH
my_config="$TELEBIT_PATH/etc/$my_app.yml"
mkdir -p "$(dirname $my_config)"
if [ ! -e "$my_config" ]; then
  #$rsync_cmd examples/$my_app.yml "$my_config"
  if [ -n "$my_email" ]; then
    echo "email: $my_email" >> "$my_config"
    echo "agree_tos: true" >> "$my_config"
  fi
  if [ -n "$my_relay" ]; then
    echo "relay: $my_relay" >> "$my_config"
  fi
  if [ -n "$my_secret" ]; then
    echo "secret: $my_secret" >> "$my_config"
  fi
  if [ -n "$my_servernames" ]; then
    # TODO could use printf or echo -e,
    # just not sure how portable they are
    echo "servernames:" >> "$my_config"
    echo "  $my_servernames: {}" >> "$my_config"
  fi
  #echo "dynamic_ports:\n  []" >> "$my_config"
  cat $TELEBIT_PATH/usr/share/$my_app.tpl.yml >> "$my_config"
fi

my_config_link="/etc/$my_app/$my_app.yml"
if [ ! -e "$my_config_link" ]; then
  echo "$sudo_cmd ln -sf '$my_config' '$my_config_link'"
  #$sudo_cmd mkdir -p /etc/$my_app
  $sudo_cmd ln -sf "$my_config" "$my_config_link"
fi

my_config="$HOME/.config/$my_app/$my_app.yml"
mkdir -p "$(dirname $my_config)"
if [ ! -e "$my_config" ]; then
  echo "cli: true" >> "$my_config"
  if [ -n "$my_email" ]; then
    echo "email: $my_email" >> "$my_config"
    echo "agree_tos: true" >> "$my_config"
  fi
  if [ -n "$my_relay" ]; then
    echo "relay: $my_relay" >> "$my_config"
  fi
  if [ -n "$my_secret" ]; then
    echo "secret: $my_secret" >> "$my_config"
  fi
  cat $TELEBIT_PATH/usr/share/$my_app.tpl.yml >> "$my_config"
fi

echo "$sudo_cmd chown -R $my_user '$TELEBIT_PATH' '/etc/$my_app'"
$sudo_cmd chown -R $my_user "$TELEBIT_PATH" "/etc/$my_app"

# ~/.config/systemd/user/
# %h/.config/telebit/telebit.yml
echo "### Adding $my_app is a system service"
# TODO detect with type -p
my_system_launcher=""
if [ -d "/Library/LaunchDaemons" ]; then
  my_system_launcher="launchd"
  my_app_launchd_service="Library/LaunchDaemons/${my_app_pkg_name}.plist"
  echo "$sudo_cmd $rsync_cmd $TELEBIT_PATH/usr/share/dist/$my_app_launchd_service /$my_app_launchd_service"
  $sudo_cmd $rsync_cmd "$TELEBIT_PATH/usr/share/dist/$my_app_launchd_service" "/$my_app_launchd_service"

  echo "$sudo_cmd chown root:wheel $my_root/$my_app_launchd_service"
  $sudo_cmd chown root:wheel "$my_root/$my_app_launchd_service"
  echo "$sudo_cmd launchctl unload -w $my_root/$my_app_launchd_service >/dev/null 2>/dev/null"
  $sudo_cmd launchctl unload -w "$my_root/$my_app_launchd_service" >/dev/null 2>/dev/null
  echo "$sudo_cmd launchctl load -w $my_root/$my_app_launchd_service"
  $sudo_cmd launchctl load -w "$my_root/$my_app_launchd_service"

elif [ -d "$my_root/etc/systemd/system" ]; then
  my_system_launcher="systemd"
  echo "$sudo_cmd $rsync_cmd $TELEBIT_PATH/usr/share/dist/etc/systemd/system/$my_app.service /etc/systemd/system/$my_app.service"
  $sudo_cmd $rsync_cmd "$TELEBIT_PATH/usr/share/dist/etc/systemd/system/$my_app.service" "/etc/systemd/system/$my_app.service"

  $sudo_cmd systemctl daemon-reload
  echo "$sudo_cmd systemctl enable $my_app"
  $sudo_cmd systemctl enable $my_app
  echo "$sudo_cmd systemctl start $my_app"
  $sudo_cmd systemctl restart $my_app
fi

sleep 1
echo ""
echo ""
echo ""
echo "=============================================="
echo "  Privacy Settings in Config"
echo "=============================================="
echo ""
echo "The example config file /etc/$my_app/$my_app.yml opts-in to"
echo "contributing telemetrics and receiving infrequent relevant updates"
echo "(probably once per quarter or less) such as important notes on"
echo "a new release, an important API change, etc. No spam."
echo ""
echo "Please edit the config file to meet your needs before starting."
echo ""
sleep 2

echo ""
echo ""
echo "=============================================="
echo "Installed successfully. Last steps:"
echo "=============================================="
echo ""

if [ "systemd" == "$my_system_launcher" ]; then

  echo "Edit the config and restart, if desired:"
  echo ""
  echo "    $sudo_cmd edit /opt/$my_app/etc/$my_app.yml"
  echo "    $sudo_cmd systemctl restart $my_app"
  echo ""
  echo "Or disabled the service and start manually:"
  echo ""
  echo "    $sudo_cmd systemctl stop $my_app"
  echo "    $sudo_cmd systemctl disable $my_app"
  echo "    $my_app --config /opt/$my_app/etc/$my_app.yml"

elif [ "launchd" == "$my_system_launcher" ]; then

  echo "Edit the config and restart, if desired:"
  echo ""
  echo "    $sudo_cmd edit /opt/$my_app/etc/$my_app.yml"
  echo "    $sudo_cmd launchctl unload $my_root/$my_app_launchd_service"
  echo "    $sudo_cmd launchctl load -w $my_root/$my_app_launchd_service"
  echo ""
  echo "Or disabled the service and start manually:"
  echo ""
  echo "    $sudo_cmd launchctl unload -w $my_root/$my_app_launchd_service"
  echo "    $my_app --config /opt/$my_app/etc/$my_app.yml"

else

  echo "Edit the config, if desired:"
  echo ""
  echo "    $sudo_cmd edit $my_config"
  echo ""
  echo "Or disabled the service and start manually:"
  echo ""
  echo "    $my_app --config $my_config"

fi

echo ""
sleep 1

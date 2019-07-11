#!/bin/bash
#<pre><code>

# This script does exactly 3 things for 1 good reason:
#
# What this does:
#
#   1. Detects either curl or wget and wraps them in helpers
#   2. Exports the helpers for the real installer
#   3. Downloads and runs the real installer
#
# Why
#
#   1. 'curl <smth> | bash -- some args here` breaks interactive input
#       See https://stackoverflow.com/questions/16854041/bash-read-is-being-skipped-when-run-from-curl-pipe
#
#   2.  It also has practical risks of running a partially downloaded script, which could be dangeresque
#       See https://news.ycombinator.com/item?id=12767636

set -e
set -u

###############################
#                             #
#         http_get            #
# boilerplate for curl / wget #
#                             #
###############################

# See https://git.coolaj86.com/coolaj86/snippets/blob/master/bash/http-get.sh

export _my_http_get=""
export _my_http_opts=""
export _my_http_out=""

detect_http_get()
{
  set +e
  if type -p curl >/dev/null 2>&1; then
    _my_http_get="curl"
    _my_http_opts="-fsSL"
    _my_http_out="-o"
  elif type -p wget >/dev/null 2>&1; then
    _my_http_get="wget"
    _my_http_opts="--quiet"
    _my_http_out="-O"
  else
    echo "Aborted, could not find curl or wget"
    return 7
  fi
  set -e
}

http_get()
{
  $_my_http_get $_my_http_opts $_my_http_out "$2" "$1"
  touch "$2"
}

http_bash()
{
  local _http_bash_url=$1
  local _http_bash_args=${2:-}
  local _http_bash_tmp=$(mktemp)
  $_my_http_get $_my_http_opts $_my_http_out "$_http_bash_tmp" "$_http_bash_url"
  bash "$_http_bash_tmp" $_http_bash_args; rm "$_http_bash_tmp"
}

detect_http_get
export -f http_get
export -f http_bash

###############################
##       END HTTP_GET        ##
###############################

# Priority
#darwin-x64			tar.gz                    28-May-2019 21:25            17630540
#linux-arm64		tar.gz                   28-May-2019 21:14            20114146
#linux-armv6l		tar.gz                  28-May-2019 21:19            19029391
#linux-armv7l		tar.gz                  28-May-2019 21:22            18890540
#linux-x64			tar.gz                     28-May-2019 21:36            20149492
#win-x64				zip                          28-May-2019 22:08            17455164
#win-x86				zip                          28-May-2019 21:57            15957629

# TODO
#aix-ppc64			tar.gz                     28-May-2019 21:45            24489408
#linux-ppc64le	tar.gz                 28-May-2019 21:18            20348655
#linux-s390x		tar.gz                   28-May-2019 21:19            20425501
#sunos-x64			tar.gz                     28-May-2019 21:19            21382759
#... cygwin?

# Extra
#x64						msi                              28-May-2019 22:09            18186240
#x86						msi                              28-May-2019 21:57            16601088
#(darwin)				pkg                                  28-May-2019 21:22            17869062

###############################
##    PLATFORM DETECTION     ##
###############################

echo "Detecting your system..."
sleep 0.5
echo ""

# OSTYPE https://stackoverflow.com/a/8597411/151312

my_os=''
my_arch=''
if [ "$(uname | grep -i 'Darwin')" ]; then
  #OSX_VER="$(sw_vers | grep ProductVersion | cut -d':' -f2 | cut -f2)"
  #OSX_MAJOR="$(echo ${OSX_VER} | cut -d'.' -f1)"
	my_os='darwin'
  #if [ -n "$(sysctl hw | grep 64bit | grep ': 1')" ]; then
  #  my_arch="amd64"
  #fi
elif [ "$(uname | grep -i 'MING')" ] || [[ "$OSTYPE" == "msys" ]]; then
	my_os='windows'
elif [ "$(uname | grep -i 'Linux')" ] || [[ "$OSTYPE" == "linux-gnu" ]]; then
	my_os='linux'
	# Find out which linux... but there are too many
	#cat /etc/issue
else
	>&2 echo "You don't appear to be on Mac (darwin), Linux, or Windows (mingw32)."
	>&2 echo "Help us support your platform by filing an issue:"
	>&2 echo "		https://git.rootprojects.org/root/telebit.js/issues"
	exit 1
fi

if [ "$(uname -m | grep -i 'ARM')" ]; then
	if [ "$(uname -m | grep -i 'v5')" ]; then
		my_arch="armv5"
	elif [ "$(uname -m | grep -i 'v6')" ]; then
		my_arch="armv6"
	elif [ "$(uname -m | grep -i 'v7')" ]; then
		my_arch="armv7"
	elif [ "$(uname -m | grep -i 'v8')" ]; then
		my_arch="armv8"
	elif [ "$(uname -m | grep -i '64')" ]; then
		my_arch="armv8"
	fi
elif [ "$(uname -m | grep -i '86')" ]; then
	if [ "$(uname -m | grep -i '64')" ]; then
		my_arch="amd64"
	else
		my_arch="386"
	fi
elif [ "$(uname -m | grep -i '64')" ]; then
	my_arch="amd64"
else
	>&2 echo "Your CPU doesn't appear to be 386, amd64 (x64), armv6, armv7, or armv8 (arm64)."
	>&2 echo "Help us support your platform by filing an issue:"
	>&2 echo "		https://git.rootprojects.org/root/telebit.js/issues"
fi

export TELEBIT_ARCH="$my_arch"
export TELEBIT_OS="$my_os"
TELEBIT_VERSION=${TELEBIT_VERSION:-stable}
export TELEBIT_RELEASE=${TELEBIT_RELEASE:-$TELEBIT_VERSION}

echo "    Operating System: $TELEBIT_OS"
echo "    Processor Family: $TELEBIT_ARCH"
echo "    Release Channel:  $TELEBIT_VERSION"
echo ""
sleep 0.3
echo "Downloading the Telebit installer for your system..."
sleep 0.5
echo ""

if [ -e "usr/share/install_helper.sh" ]; then
  bash usr/share/install_helper.sh "$@"
else
  http_bash https://git.coolaj86.com/coolaj86/telebit.js/raw/branch/$TELEBIT_VERSION/usr/share/install_helper.sh "$@"
fi

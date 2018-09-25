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

if [ -n "${TELEBIT_VERSION:-}" ]; then
  echo 'TELEBIT_VERSION='${TELEBIT_VERSION}
fi
export TELEBIT_VERSION=${TELEBIT_VERSION:-master}
if [ -e "usr/share/install_helper.sh" ]; then
  bash usr/share/install_helper.sh "$@"
else
  http_bash https://git.coolaj86.com/coolaj86/telebit.js/raw/branch/$TELEBIT_VERSION/usr/share/install_helper.sh "$@"
fi

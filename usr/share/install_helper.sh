#!/bin/bash
#<pre><code>

# This downloads the telebit zip (Windows) or tarball (Mac, Linux),
# unpacks it, and then completes the installation

set -e
set -u

### http_get, http_bash, archiver, and archive_ext are exported by get.sh

mkdir -p $HOME/Downloads
my_tmp="$(mktemp -d -t telebit.XXXX)"
http_get "https://rootprojects.org/telebit/dist/index.tab" "$my_tmp/index.tab"
latest=$(grep $TELEBIT_RELEASE $my_tmp/index.tab | grep $TELEBIT_OS | grep $TELEBIT_ARCH | head -n 1 | cut -f 1)
major=$(grep $TELEBIT_RELEASE $my_tmp/index.tab | grep $TELEBIT_OS | grep $TELEBIT_ARCH | head -n 1 | cut -f 2)
size=$(grep $TELEBIT_RELEASE $my_tmp/index.tab | grep $TELEBIT_OS | grep $TELEBIT_ARCH | head -n 1 | cut -f 3)
#latest=$(grep $TELEBIT_RELEASE $my_tmp/index.tab | grep $TELEBIT_OS | grep $TELEBIT_ARCH | head -n 1 | cut -f 1)
my_dir="telebit-$latest-$TELEBIT_OS-$TELEBIT_ARCH"
my_file="$my_dir.$archive_ext"
if [ -f "$HOME/Downloads/$my_file" ]; then
  my_size=$(($(wc -c < "$HOME/Downloads/$my_file")))
  if [ "$my_size" -eq "$size" ]; then
    echo "File exists in ~/Downloads, skipping download"
  else
    echo "Removing corrupt download '~/Downloads/$my_file'"
    rm -f "$HOME/Downloads/$my_file"
  fi
fi
if [ ! -f "$HOME/Downloads/$my_file" ]; then
  echo "Downloading from https://rootprojects.org/telebit/dist/$major/$my_file ..."
  sleep 0.3
  http_get "https://rootprojects.org/telebit/dist/$major/$my_file" "$HOME/Downloads/$my_file"
  echo "Saved to '$HOME/Downloads/$my_file' ..."
  echo ""
  sleep 0.3
fi
echo "Unpacking and installing Telebit ..."
unarchiver $my_file $my_tmp
pushd $my_tmp/$my_dir
bash ./setup.sh

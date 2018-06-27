echo ""
echo ""
echo "=============================================="
echo "            Launcher Configuration            "
echo "=============================================="
echo ""

my_stopper=""
if [ "systemd" == "$my_system_launcher" ]; then

  my_stopper="${real_sudo_cmde}systemctl stop $my_app"
  echo "Edit the config and restart, if desired:"
  echo ""
  echo "    ${real_sudo_cmde}$my_edit $TELEBITD_CONFIG"
  echo "    ${real_sudo_cmde}systemctl restart $my_app"
  echo ""
  echo "Or disabled the service and start manually:"
  echo ""
  echo "    ${real_sudo_cmde}systemctl stop $my_app"
  echo "    ${real_sudo_cmde}systemctl disable $my_app"
  echo "    $my_daemon --config $TELEBITD_CONFIG"

elif [ "launchd" == "$my_system_launcher" ]; then

  my_stopper="${real_sudo_cmde}launchctl unload $my_app_launchd_service"
  echo "Edit the config and restart, if desired:"
  echo ""
  echo "    ${real_sudo_cmde}$my_edit $TELEBITD_CONFIG"
  echo "    ${real_sudo_cmde}launchctl unload $my_app_launchd_service"
  echo "    ${real_sudo_cmde}launchctl load -w $my_app_launchd_service"
  echo ""
  echo "Or disabled the service and start manually:"
  echo ""
  echo "    ${real_sudo_cmde}launchctl unload -w $my_app_launchd_service"
  echo "    $my_daemon --config $TELEBITD_CONFIG"

else

  my_stopper="not started"
  echo ""
  echo "Run the service manually (we couldn't detect your system service to do that automatically):"
  echo ""
  echo "    $my_daemon --config $TELEBITD_CONFIG"
  echo "    $my_app --config $TELEBIT_CONFIG"

fi

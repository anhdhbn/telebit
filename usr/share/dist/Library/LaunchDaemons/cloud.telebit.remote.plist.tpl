<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>Telebit Remote</string>
	<key>ProgramArguments</key>
	<array>
		<string>{TELEBIT_PATH}/bin/node</string>
		<string>{TELEBIT_PATH}/bin/telebitd.js</string>
		<string>daemon</string>
		<string>--config</string>
    <string>{TELEBIT_PATH}/etc/telebitd.yml</string>
	</array>
	<key>EnvironmentVariables</key>
	<dict>
		<key>TELEBIT_PATH</key>
		<string>{TELEBIT_PATH}</string>
		<key>NODE_PATH</key>
		<string>{TELEBIT_PATH}/lib/node_modules</string>
		<key>NPM_CONFIG_PREFIX</key>
		<string>{TELEBIT_PATH}</string>
	</dict>

	<key>UserName</key>
	<string>{TELEBIT_USER}</string>
	<key>GroupName</key>
	<string>{TELEBIT_GROUP}</string>
	<key>InitGroups</key>
	<true/>

	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<!--dict>
		<key>Crashed</key>
		<true/>
		<key>NetworkState</key>
		<true/>
		<key>SuccessfulExit</key>
		<false/>
	</dict-->

	<key>SoftResourceLimits</key>
	<dict>
		<key>NumberOfFiles</key>
		<integer>8192</integer>
	</dict>
	<key>HardResourceLimits</key>
	<dict/>

	<key>WorkingDirectory</key>
  <string>{TELEBIT_PATH}</string>

	<key>StandardErrorPath</key>
  <string>{TELEBIT_PATH}/var/log/error.log</string>
	<key>StandardOutPath</key>
  <string>{TELEBIT_PATH}/var/log/info.log</string>
</dict>
</plist>
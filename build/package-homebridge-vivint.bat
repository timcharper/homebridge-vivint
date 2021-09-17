rmdir /S /Q release-homebridge-vivint
mkdir release-homebridge-vivint\lib
robocopy lib release-homebridge-vivint\lib /E /XD homebridge-ui
robocopy test release-homebridge-vivint\test /E
copy index.js release-homebridge-vivint
copy ring-auth-cli.js release-homebridge-vivint
copy CHANGELOG.md release-homebridge-vivint
copy package.json release-homebridge-vivint
copy package-lock.json release-homebridge-vivint
copy LICENSE release-homebridge-vivint
copy README.md release-homebridge-vivint
copy config.schema.json release-homebridge-vivint
copy homebridge-vivint.svg release-homebridge-vivint
copy vivint_mfa_cli.js release-homebridge-vivint
robocopy lib\homebridge-ui\build release-homebridge-vivint\lib\homebridge-ui\public /E /MOVE
copy lib\homebridge-ui\LICENSE release-homebridge-vivint\lib\homebridge-ui
copy lib\homebridge-ui\server.js release-homebridge-vivint\lib\homebridge-ui
@ECHO .
@ECHO If the build succeeded you can publish to NPM by running the following commands:
@ECHO cd release-homebridge-vivint
@ECHO npm publish
@ECHO .
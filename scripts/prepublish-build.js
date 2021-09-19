const fs = require('fs-extra');
const cp = require('child_process');

const DIST_DIR = 'dist';
const UI_DIR = './lib/homebridge-ui';

console.log('Preparing package for publishing');

console.log('Installing UI dependencies');
cp.execSync('npm install', {
  stdio: [0, 1, 2],
  cwd: UI_DIR
});

console.log('Building UI distribution');
cp.execSync('npm run build', {
  stdio: [0, 1, 2],
  cwd: UI_DIR
});

console.log('Copying files to distribution directory');
fs.removeSync(DIST_DIR, { recursive: true });
fs.mkdirSync(DIST_DIR, { recursive: true });
fs.moveSync('./lib/homebridge-ui/build', './dist/homebridge-ui/public');
fs.copySync('./lib/homebridge-ui/LICENSE', './dist/homebridge-ui/LICENSE');
fs.copySync('./lib/homebridge-ui/server.js', './dist/homebridge-ui/server.js');

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');

fs.writeFileSync(os.tmpdir() + '/root-test.txt',
  'process.type: ' + process.type + '\n' +
  'app type: ' + typeof app
);

if (app) {
  app.whenReady().then(() => {
    new BrowserWindow({ width: 400, height: 300 }).loadURL('about:blank');
  });
}

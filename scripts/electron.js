'use strict';
const { spawn } = require('child_process');
const env = { ...process.env };
// IDE terminals sometimes inherit this flag, turning Electron into plain Node.
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), process.argv.slice(2), { env, stdio: 'inherit', windowsHide: true });
child.on('error', (err) => { console.error(err.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code == null ? 1 : code; });

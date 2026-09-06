'use strict';
const { spawn } = require('child_process');
const env = { ...process.env };
// IDE terminals sometimes inherit this flag, turning Electron into plain Node.
delete env.ELECTRON_RUN_AS_NODE;
const args = process.argv.slice(2);
// Interactive apps must not inherit Windows' hidden startup-window flag.
// Test runners create their own hidden BrowserWindows.
const interactive = args[0] === '.' || /(?:^|[\\/])simulator\.js$/.test(args[0] || '');
const child = spawn(require('electron'), args, { env, stdio: 'inherit', windowsHide: !interactive });
child.on('error', (err) => { console.error(err.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code == null ? 1 : code; });

'use strict';
const https = require('https');
const fs = require('fs');
const { execFile } = require('child_process');

const LOCKFILE_PATHS = [
  'C:/Riot Games/League of Legends/lockfile',
  'C:/Program Files/Riot Games/League of Legends/lockfile',
  'C:/Program Files (x86)/Riot Games/League of Legends/lockfile',
  'D:/Riot Games/League of Legends/lockfile',
];

// The client serves a self-signed cert, so verification has to be off for 127.0.0.1.
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

function parseLockfile(text) {
  // format: LeagueClient:<pid>:<port>:<password>:https
  const parts = text.trim().split(':');
  if (parts.length < 5) return null;
  const port = parseInt(parts[2], 10);
  if (!port) return null;
  return { port, password: parts[3], protocol: parts[4] };
}

function credsFromLockfile() {
  for (const p of LOCKFILE_PATHS) {
    try {
      const creds = parseLockfile(fs.readFileSync(p, 'utf8'));
      if (creds) return creds;
    } catch (_) { /* not this path */ }
  }
  return null;
}

// Fallback for non-standard install dirs: read the port/token off the running process.
function credsFromProcess() {
  return new Promise((resolve) => {
    const ps = 'Get-CimInstance Win32_Process -Filter "Name=\'LeagueClientUx.exe\'" | ' +
               'Select-Object -ExpandProperty CommandLine';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 8000, windowsHide: true }, (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const port = /--app-port=("?)(\d+)\1/.exec(stdout);
        const token = /--remoting-auth-token=("?)([\w-]+)\1/.exec(stdout);
        if (!port || !token) return resolve(null);
        resolve({ port: parseInt(port[2], 10), password: token[2], protocol: 'https' });
      });
  });
}

class LcuClient {
  constructor() {
    this.creds = null;
  }

  async connect() {
    const creds = credsFromLockfile() || await credsFromProcess();
    if (!creds) {
      this.creds = null;
      throw new Error('CLIENT_NOT_FOUND');
    }
    this.creds = creds;
    return creds;
  }

  // Ensures we have creds, reconnecting if the client restarted on a new port.
  async ensure() {
    if (!this.creds) await this.connect();
    return this.creds;
  }

  request(path) {
    return new Promise((resolve, reject) => {
      const { port, password } = this.creds;
      const req = https.request({
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        agent,
        headers: {
          Authorization: 'Basic ' + Buffer.from('riot:' + password).toString('base64'),
          Accept: 'application/json',
        },
        timeout: 5000,
      }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(body); } catch (_) { /* non-json */ }
          resolve({ status: res.statusCode, body: json });
        });
      });
      req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
      req.on('error', reject);
      req.end();
    });
  }

  async get(path) {
    await this.ensure();
    try {
      return await this.request(path);
    } catch (err) {
      // Port likely changed (client restarted) - re-discover once and retry.
      this.creds = null;
      await this.ensure();
      return this.request(path);
    }
  }

  async getPhase() {
    const res = await this.get('/lol-gameflow/v1/gameflow-phase');
    return typeof res.body === 'string' ? res.body : null;
  }

  async getSession() {
    const res = await this.get('/lol-champ-select/v1/session');
    if (res.status !== 200 || !res.body || res.body.errorCode) return null;
    return res.body;
  }

  async getCurrentSummoner() {
    const res = await this.get('/lol-summoner/v1/current-summoner');
    return res.status === 200 ? res.body : null;
  }
}

module.exports = { LcuClient, parseLockfile };

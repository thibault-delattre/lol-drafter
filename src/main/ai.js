'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// The npm package ships a native binary; spawning it directly avoids the
// Windows .cmd/shell quoting problems.
function resolveClaude() {
  const appData = process.env.APPDATA || '';
  const candidates = [
    path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return { cmd: c, shell: false };
  }
  return { cmd: 'claude', shell: true }; // fall back to PATH lookup
}

const BASE_ARGS = [
  '-p',
  '--output-format', 'stream-json',
  '--include-partial-messages',
  '--verbose',
  '--allowed-tools', '',
  '--strict-mcp-config',
  '--mcp-config', '{"mcpServers":{}}',
  '--setting-sources', '',
];

// Pulls the JSON object out of the model's reply, tolerating stray prose or fences.
function extractJson(text) {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch (_) { return null; }
}

/**
 * Hard guarantee that we never surface an illegal pick, even if the model slips.
 * Returns the parsed result with each entry marked legal/illegal.
 */
function validate(parsed, state, champions) {
  if (!parsed) return null;
  const byName = new Map();
  for (const id of Object.keys(champions)) {
    byName.set(champions[id].name.toLowerCase(), champions[id]);
  }

  const check = (entry) => {
    const raw = (entry.champ || entry.champion || '').trim();
    const champ = byName.get(raw.toLowerCase());
    if (!champ) return { ...entry, champ: raw, unknown: true };
    const blocked = state.unavailable.has(champ.id);
    return {
      ...entry,
      champ: champ.name,
      championId: champ.id,
      slug: champ.slug,
      blocked,
      blockedReason: blocked ? 'banned or already picked' : null,
    };
  };

  const picks = (parsed.picks || []).map(check);
  return {
    read: parsed.read || '',
    picks: picks.filter((p) => !p.blocked && !p.unknown),
    rejected: picks.filter((p) => p.blocked || p.unknown),
    avoid: (parsed.avoid || []).map(check),
  };
}

/**
 * Pulls out whichever pick objects have finished generating, so the UI can show
 * them one at a time instead of waiting for the whole response.
 */
function progressivePicks(text) {
  if (!text) return [];
  const key = text.indexOf('"picks"');
  if (key === -1) return [];
  const arr = text.indexOf('[', key);
  if (arr === -1) return [];

  const out = [];
  let depth = 0;
  let start = -1;
  for (let i = arr; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try { out.push(JSON.parse(text.slice(start, i + 1))); } catch (_) { /* not complete */ }
        start = -1;
      }
    } else if (ch === ']' && depth === 0) {
      break;
    }
  }
  return out;
}

class Analyzer {
  constructor(opts) {
    this.model = (opts && opts.model) || 'sonnet';
    this.proc = null;
  }

  cancel() {
    if (this.proc) {
      try { this.proc.kill(); } catch (_) { /* already gone */ }
      this.proc = null;
    }
  }

  /**
   * Streams an analysis. Calls handlers.onDelta(textChunk) as tokens arrive and
   * handlers.onDone(rawText) at the end. Rejects on spawn/parse failure.
   */
  run(prompt, handlers) {
    this.cancel();
    const h = handlers || {};
    const { cmd, shell } = resolveClaude();

    return new Promise((resolve, reject) => {
      const args = BASE_ARGS.concat(['--model', this.model]);
      let proc;
      try {
        proc = spawn(cmd, args, { shell, windowsHide: true });
      } catch (err) {
        return reject(new Error('Could not start the Claude CLI: ' + err.message));
      }
      this.proc = proc;

      let full = '';
      let stderr = '';
      let settled = false;

      const rl = readline.createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        if (!line.trim()) return;
        let msg;
        try { msg = JSON.parse(line); } catch (_) { return; }

        if (msg.type === 'stream_event' && msg.event) {
          const ev = msg.event;
          if (ev.type === 'content_block_delta' && ev.delta && typeof ev.delta.text === 'string') {
            full += ev.delta.text;
            if (h.onDelta) h.onDelta(ev.delta.text, full);
          }
        } else if (msg.type === 'result') {
          if (typeof msg.result === 'string' && msg.result.length > full.length) full = msg.result;
          if (msg.is_error) stderr += '\n' + (msg.result || 'CLI reported an error');
        }
      });

      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('error', (err) => {
        if (settled) return;
        settled = true;
        this.proc = null;
        reject(new Error('Claude CLI failed to launch: ' + err.message));
      });

      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        this.proc = null;
        if (h.onDone) h.onDone(full);
        if (!full.trim()) {
          return reject(new Error(
            code === 0 ? 'Claude returned an empty response'
                       : 'Claude CLI exited with code ' + code + (stderr ? ': ' + stderr.slice(0, 300) : '')));
        }
        resolve(full);
      });

      // The prompt goes over stdin so its length and quoting never matter.
      proc.stdin.on('error', () => { /* closed early; handled by close */ });
      proc.stdin.write(prompt);
      proc.stdin.end();
    });
  }
}

module.exports = { Analyzer, extractJson, validate, resolveClaude, progressivePicks };

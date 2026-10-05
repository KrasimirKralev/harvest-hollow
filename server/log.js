// Structured logging (lane brief item 6). One line per event:
//   2026-10-02T21:00:00.123Z ERROR rule threw type=plant pid=p1 err="TypeError: ..."
// or one JSON object per line with HH_LOG=json (for log shippers). Under systemd both land in the journal.
//
// The signature stays console-compatible, so every module (and every test's quiet stub) can call
// log.warn('text'), log.error('text', err) or log.error('text', { type, pid }) alike:
//   - a plain object argument becomes key=value fields,
//   - an Error becomes err=<message> plus its stack on the following lines (text mode) or `stack` (JSON),
//   - anything else is appended to the message.
const LEVELS = { info: 'INFO', warn: 'WARN', error: 'ERROR' };
const COLOR = { WARN: '\x1b[33m', ERROR: '\x1b[31m' };
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Error);

function fmtValue(v) {
  if (typeof v === 'number' || typeof v === 'boolean' || v === null || v === undefined) return String(v);
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return /^[\w.:/@+-]+$/.test(s) ? s : JSON.stringify(s);
}

/**
 * Split console-style arguments into { msg, fields, stack }.
 * @param {unknown[]} args
 */
export function parseArgs(args) {
  const words = [];
  const fields = {};
  let stack = null;
  for (const a of args) {
    if (a instanceof Error) {
      fields.err = a.message;
      if (a.code) fields.code = a.code;
      stack = a.stack || null;
    } else if (isPlain(a)) {
      Object.assign(fields, a);
    } else {
      words.push(typeof a === 'string' ? a : fmtValue(a));
    }
  }
  return { msg: words.join(' ').replace(ANSI, ''), fields, stack };
}

/**
 * @param {{ quiet?: boolean, json?: boolean, out?: { write(s: string): unknown },
 *   err?: { write(s: string): unknown }, color?: boolean, now?: () => Date }} [o]
 * @returns {{ info: Function, warn: Function, error: Function, log: Function }}
 */
export function createLogger({ quiet = false, json = false, out = process.stdout, err = process.stderr,
  color = Boolean(process.stdout.isTTY), now = () => new Date() } = {}) {
  const write = (level, args) => {
    if (quiet && level === 'INFO') return;
    const { msg, fields, stack } = parseArgs(args);
    const ts = now().toISOString();
    let line;
    if (json) {
      line = JSON.stringify({ ts, level, msg, ...fields, ...(stack ? { stack } : {}) });
    } else {
      const kv = Object.entries(fields).map(([k, v]) => `${k}=${fmtValue(v)}`).join(' ');
      const body = `${ts} ${level.padEnd(5)} ${msg}${kv ? ` ${kv}` : ''}`;
      line = color && COLOR[level] ? `${COLOR[level]}${body}\x1b[0m` : body;
      if (stack && level === 'ERROR') line += `\n  ${stack.split('\n').slice(1, 6).map((s) => s.trim()).join('\n  ')}`;
    }
    (level === 'INFO' ? out : err).write(`${line}\n`);
  };
  return {
    info: (...a) => write(LEVELS.info, a),
    log: (...a) => write(LEVELS.info, a),
    warn: (...a) => write(LEVELS.warn, a),
    error: (...a) => write(LEVELS.error, a),
  };
}

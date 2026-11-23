/**
 * Parse a .env formatted string into a key-value map and structured entries.
 * Supports comments, quoted values (single/double/backtick), multiline double-quoted values,
 * escaped sequences, `export KEY=VALUE` prefixes, and inline comments.
 */

/**
 * @typedef {Object} EnvEntry
 * @property {string} key
 * @property {string} value
 * @property {number} line
 * @property {boolean} exported
 */

/**
 * @typedef {Object} ParseResult
 * @property {Record<string, string>} values
 * @property {EnvEntry[]} entries
 * @property {Array<{ line: number, message: string }>} warnings
 */

const KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Unescape double-quoted .env values.
 * @param {string} raw
 * @returns {string}
 */
function unescapeDoubleQuoted(raw) {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/**
 * Strip unquoted inline comments (preceded by whitespace).
 * @param {string} raw
 * @returns {string}
 */
function stripInlineComment(raw) {
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '#' && (i === 0 || /\s/.test(raw[i - 1]))) {
      return raw.slice(0, i).trimEnd();
    }
  }
  return raw.trimEnd();
}

/**
 * Parse `.env` content into values, entries, and syntax warnings.
 * @param {string} content
 * @returns {ParseResult}
 */
export function parseEnv(content) {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  /** @type {Record<string, string>} */
  const values = {};
  /** @type {EnvEntry[]} */
  const entries = [];
  /** @type {Array<{ line: number, message: string }>} */
  const warnings = [];
  const seenKeys = new Map();

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    let line = lines[i].trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    let exported = false;
    if (line.startsWith('export ') || line.startsWith('export\t')) {
      exported = true;
      line = line.slice(6).trim();
    }

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      warnings.push({ line: lineNum, message: `Missing '=' assignment on line ${lineNum}` });
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    if (!KEY_REGEX.test(key)) {
      warnings.push({ line: lineNum, message: `Invalid variable name '${key}' on line ${lineNum}` });
      continue;
    }

    if (seenKeys.has(key)) {
      warnings.push({
        line: lineNum,
        message: `Duplicate key '${key}' (first defined on line ${seenKeys.get(key)})`
      });
    }
    seenKeys.set(key, lineNum);

    let rawVal = line.slice(eqIndex + 1).trimStart();
    let value = '';

    if (rawVal.startsWith('"') || rawVal.startsWith("'") || rawVal.startsWith('`')) {
      const quote = rawVal[0];
      let buf = rawVal.slice(1);
      let closed = false;

      // Find closing unescaped quote (supporting multiline)
      while (!closed) {
        let endIdx = -1;
        for (let j = 0; j < buf.length; j++) {
          if (buf[j] === quote && (quote === "'" || j === 0 || buf[j - 1] !== '\\')) {
            endIdx = j;
            break;
          }
        }
        if (endIdx !== -1) {
          const inner = buf.slice(0, endIdx);
          value = quote === '"' ? unescapeDoubleQuoted(inner) : inner;
          closed = true;
        } else if (i + 1 < lines.length) {
          i++;
          buf += '\n' + lines[i];
        } else {
          warnings.push({ line: lineNum, message: `Unterminated ${quote} quote for '${key}'` });
          value = quote === '"' ? unescapeDoubleQuoted(buf) : buf;
          closed = true;
        }
      }
    } else {
      value = stripInlineComment(rawVal);
    }

    values[key] = value;
    entries.push({ key, value, line: lineNum, exported });
  }

  return { values, entries, warnings };
}

/**
 * Mask a value so secrets are never accidentally printed in logs or CI output.
 * @param {string} value
 * @returns {string}
 */
export function maskValue(value) {
  if (!value) return '(empty)';
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}${'*'.repeat(Math.min(value.length - 4, 12))}${value.slice(-2)}`;
}

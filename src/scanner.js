/**
 * Secret and credential leak detector for source files and environment configs.
 * Combines curated high-precision provider patterns with Shannon entropy heuristics.
 */

import fs from 'node:fs';
import path from 'node:path';
import { maskValue } from './parser.js';

/**
 * @typedef {Object} SecretFinding
 * @property {string} ruleId
 * @property {string} ruleName
 * @property {'high'|'medium'} severity
 * @property {string} file
 * @property {number} line
 * @property {string} matchMasked
 */

export const SECRET_RULES = [
  {
    id: 'openai-api-key',
    name: 'OpenAI API Key',
    severity: 'high',
    regex: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g
  },
  {
    id: 'aws-access-key',
    name: 'AWS Access Key ID',
    severity: 'high',
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g
  },
  {
    id: 'github-pat',
    name: 'GitHub Personal Access Token',
    severity: 'high',
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g
  },
  {
    id: 'github-fine-grained-pat',
    name: 'GitHub Fine-Grained Token',
    severity: 'high',
    regex: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g
  },
  {
    id: 'stripe-live-key',
    name: 'Stripe Live Secret Key',
    severity: 'high',
    regex: /\b(?:sk_live|rk_live)_[A-Za-z0-9]{20,}\b/g
  },
  {
    id: 'google-api-key',
    name: 'Google Cloud API Key',
    severity: 'high',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g
  },
  {
    id: 'slack-token',
    name: 'Slack Bot/User Token',
    severity: 'high',
    regex: /\bxox[baprs]-[0-9A-Za-z-]{10,48}\b/g
  },
  {
    id: 'private-key-header',
    name: 'PEM Private Key Block',
    severity: 'high',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g
  },
  {
    id: 'generic-secret-assignment',
    name: 'Hardcoded Secret Assignment',
    severity: 'medium',
    regex: /\b(?:API_KEY|API_SECRET|AUTH_TOKEN|JWT_SECRET|DATABASE_URL|PRIVATE_KEY|ACCESS_TOKEN|CLIENT_SECRET)\s*[:=]\s*['"]?([A-Za-z0-9+/=._:@-]{24,})['"]?/gi,
    captureGroup: 1,
    minEntropy: 3.5
  }
];

const PLACEHOLDER_TOKENS = [
  'example',
  'placeholder',
  'changeme',
  'your_',
  'your-',
  'replace_me',
  'dummy',
  'test_key',
  'fake',
  'xxxx',
  '000000'
];

const DEFAULT_IGNORES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  'vendor'
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip',
  '.gz', '.tar', '.wasm', '.exe', '.dll', '.so', '.dylib', '.mp4', '.mp3', '.woff', '.woff2'
]);

/**
 * Compute Shannon entropy (bits per character) of a string.
 * @param {string} str
 * @returns {number}
 */
export function shannonEntropy(str) {
  if (!str) return 0;
  const freq = new Map();
  for (const ch of str) {
    freq.set(ch, (freq.get(ch) || 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Check if a candidate value looks like a harmless placeholder.
 * @param {string} val
 * @returns {boolean}
 */
function isPlaceholder(val) {
  const lower = val.toLowerCase();
  return PLACEHOLDER_TOKENS.some((tok) => lower.includes(tok));
}

/**
 * Scan text content for leaked secrets.
 * @param {string} content
 * @param {string} [fileLabel='<memory>']
 * @returns {SecretFinding[]}
 */
export function scanTextForSecrets(content, fileLabel = '<memory>') {
  /** @type {SecretFinding[]} */
  const findings = [];
  const lines = content.replace(/\r\n/g, '\n').split('\n');

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (line.includes('envguard-ignore')) continue;

    for (const rule of SECRET_RULES) {
      rule.regex.lastIndex = 0;
      let match;
      while ((match = rule.regex.exec(line)) !== null) {
        const candidate = rule.captureGroup ? match[rule.captureGroup] : match[0];
        if (!candidate || isPlaceholder(candidate)) continue;
        if (rule.minEntropy && shannonEntropy(candidate) < rule.minEntropy) continue;

        findings.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: /** @type {'high'|'medium'} */ (rule.severity),
          file: fileLabel,
          line: idx + 1,
          matchMasked: maskValue(candidate)
        });
      }
    }
  }

  return findings;
}

/**
 * Recursively scan a file or directory for leaked secrets.
 * @param {string} targetPath
 * @param {{ ignoreDirs?: string[], maxFileSizeBytes?: number }} [options]
 * @returns {{ scannedFiles: number, findings: SecretFinding[] }}
 */
export function scanPathForSecrets(targetPath, options = {}) {
  const ignoreDirs = new Set([...DEFAULT_IGNORES, ...(options.ignoreDirs || [])]);
  const maxFileSizeBytes = options.maxFileSizeBytes ?? 512 * 1024;
  /** @type {SecretFinding[]} */
  const findings = [];
  let scannedFiles = 0;

  /** @param {string} current */
  function walk(current) {
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && ignoreDirs.has(entry.name)) continue;
        walk(path.join(current, entry.name));
      }
      return;
    }

    if (!stat.isFile() || stat.size > maxFileSizeBytes) return;
    const ext = path.extname(current).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) return;

    const text = fs.readFileSync(current, 'utf8');
    if (text.includes('\u0000')) return; // binary guard
    scannedFiles++;
    const fileFindings = scanTextForSecrets(text, current);
    findings.push(...fileFindings);
  }

  walk(targetPath);
  return { scannedFiles, findings };
}

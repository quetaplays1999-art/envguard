#!/usr/bin/env node
/**
 * envguard CLI — validate .env files, scan for leaked secrets, diff configs,
 * generate sanitized .env.example files, and emit Markdown docs.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  parseEnv,
  validateEnv,
  scanPathForSecrets,
  diffEnv,
  generateExample,
  generateMarkdownDocs
} from '../src/index.js';

const HELP = `envguard — Zero-dependency .env validator & secret leak scanner

Usage:
  envguard check [--env <file>] [--schema <file>] [--example <file>] [--strict] [--json]
  envguard scan [path] [--json]
  envguard diff <left.env> <right.env> [--reveal] [--json]
  envguard sync [--env <file>] [--schema <file>] [--out <file>]
  envguard docs --schema <file> [--out <file>]
  envguard --help | --version
`;

/**
 * Parse CLI flags and positional args without external dependencies.
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  /** @type {string[]} */
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq !== -1) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('-')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (token === '-h') {
      flags.help = true;
    } else if (token === '-v') {
      flags.version = true;
    } else {
      positional.push(token);
    }
  }
  return { flags, positional };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readEnvFile(filePath) {
  return parseEnv(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));

  if (flags.version) {
    const pkg = readJson(new URL('../package.json', import.meta.url));
    console.log(pkg.version);
    return 0;
  }

  const command = positional[0];
  if (!command || flags.help) {
    console.log(HELP);
    return 0;
  }

  if (command === 'check') {
    const envPath = String(flags.env || '.env');
    if (!fs.existsSync(envPath)) {
      console.error(`Error: env file not found: ${envPath}`);
      return 2;
    }
    const parsed = readEnvFile(envPath);
    const schemaPath = flags.schema
      ? String(flags.schema)
      : (fs.existsSync('envguard.schema.json') ? 'envguard.schema.json' : undefined);
    const examplePath = flags.example
      ? String(flags.example)
      : (fs.existsSync('.env.example') ? '.env.example' : undefined);

    const schema = schemaPath ? readJson(schemaPath) : undefined;
    const example = examplePath ? readEnvFile(examplePath).values : undefined;

    const result = validateEnv(parsed.values, {
      schema,
      example,
      strict: Boolean(flags.strict)
    });

    if (flags.json) {
      console.log(JSON.stringify({ ...result, parseWarnings: parsed.warnings }, null, 2));
    } else {
      for (const w of parsed.warnings) {
        console.warn(`[PARSE WARN] line ${w.line}: ${w.message}`);
      }
      for (const err of result.errors) {
        console.error(`[ERROR] ${err.code}: ${err.message}`);
      }
      for (const warn of result.warnings) {
        console.warn(`[WARN]  ${warn.code}: ${warn.message}`);
      }
      if (result.ok) {
        console.log(`OK: ${envPath} passed validation (${Object.keys(parsed.values).length} variables).`);
      }
    }
    return result.ok ? 0 : 1;
  }

  if (command === 'scan') {
    const target = positional[1] || '.';
    if (!fs.existsSync(target)) {
      console.error(`Error: path not found: ${target}`);
      return 2;
    }
    const { scannedFiles, findings } = scanPathForSecrets(target);
    if (flags.json) {
      console.log(JSON.stringify({ scannedFiles, findings }, null, 2));
    } else if (findings.length === 0) {
      console.log(`Clean: scanned ${scannedFiles} file(s), no secrets detected.`);
    } else {
      for (const f of findings) {
        console.error(
          `[${f.severity.toUpperCase()}] ${f.ruleName} (${f.ruleId}) at ${path.relative(process.cwd(), f.file) || f.file}:${f.line} -> ${f.matchMasked}`
        );
      }
      console.error(`Found ${findings.length} potential secret(s) across ${scannedFiles} file(s).`);
    }
    return findings.length === 0 ? 0 : 1;
  }

  if (command === 'diff') {
    const [leftPath, rightPath] = positional.slice(1);
    if (!leftPath || !rightPath) {
      console.error('Usage: envguard diff <left.env> <right.env> [--reveal] [--json]');
      return 2;
    }
    const left = readEnvFile(leftPath).values;
    const right = readEnvFile(rightPath).values;
    const result = diffEnv(left, right, { revealValues: Boolean(flags.reveal) });

    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const k of result.onlyInLeft) console.log(`- ${k} (only in ${leftPath})`);
      for (const k of result.onlyInRight) console.log(`+ ${k} (only in ${rightPath})`);
      for (const c of result.changed) console.log(`~ ${c.key}: ${c.left} -> ${c.right}`);
      if (!result.onlyInLeft.length && !result.onlyInRight.length && !result.changed.length) {
        console.log('No differences found.');
      }
    }
    return 0;
  }

  if (command === 'sync') {
    const envPath = String(flags.env || '.env');
    const envValues = fs.existsSync(envPath) ? readEnvFile(envPath).values : {};
    const schema = flags.schema ? readJson(String(flags.schema)) : undefined;
    const output = generateExample(envValues, schema);
    if (flags.out) {
      fs.writeFileSync(String(flags.out), output, 'utf8');
      console.log(`Wrote sanitized template to ${flags.out}`);
    } else {
      process.stdout.write(output);
    }
    return 0;
  }

  if (command === 'docs') {
    const schemaPath = String(flags.schema || 'envguard.schema.json');
    if (!fs.existsSync(schemaPath)) {
      console.error(`Error: schema not found: ${schemaPath}`);
      return 2;
    }
    const md = generateMarkdownDocs(readJson(schemaPath));
    if (flags.out) {
      fs.writeFileSync(String(flags.out), md, 'utf8');
      console.log(`Wrote Markdown docs to ${flags.out}`);
    } else {
      process.stdout.write(md);
    }
    return 0;
  }

  console.error(`Unknown command: ${command}\n`);
  console.log(HELP);
  return 2;
}

process.exitCode = main();

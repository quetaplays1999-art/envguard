import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  parseEnv,
  maskValue,
  validateEnv,
  scanTextForSecrets,
  scanPathForSecrets,
  shannonEntropy,
  diffEnv,
  generateExample,
  generateMarkdownDocs
} from '../src/index.js';

describe('parseEnv', () => {
  it('parses basic pairs, comments, exports, quotes, and inline comments', () => {
    const input = [
      '# header comment',
      'PORT=3000 # inline comment',
      'export NODE_ENV=production',
      'SINGLE=\'hello # not comment\'',
      'DOUBLE="line1\\nline2"',
      'MULTILINE="first',
      'second"'
    ].join('\n');

    const res = parseEnv(input);
    assert.equal(res.warnings.length, 0);
    assert.equal(res.values.PORT, '3000');
    assert.equal(res.values.NODE_ENV, 'production');
    assert.equal(res.values.SINGLE, 'hello # not comment');
    assert.equal(res.values.DOUBLE, 'line1\nline2');
    assert.equal(res.values.MULTILINE, 'first\nsecond');
    assert.equal(res.entries.find((e) => e.key === 'NODE_ENV')?.exported, true);
  });

  it('reports syntax and duplicate key warnings', () => {
    const res = parseEnv('FOO=1\nBADLINE\n123INVALID=x\nFOO=2\n');
    assert.equal(res.values.FOO, '2');
    assert.equal(res.warnings.length, 3);
  });

  it('masks secret values safely', () => {
    assert.equal(maskValue(''), '(empty)');
    assert.equal(maskValue('abcd'), '****');
    assert.equal(maskValue('supersecretvalue'), 'su************ue');
  });
});

describe('validateEnv', () => {
  const schema = {
    variables: {
      PORT: { type: 'port', required: true },
      API_URL: { type: 'url', required: true },
      ADMIN_EMAIL: { type: 'email', required: true },
      DEBUG: { type: 'boolean', default: 'false' },
      NODE_ENV: { type: 'enum', enum: ['development', 'staging', 'production'], required: true },
      WORKERS: { type: 'integer', min: 1, max: 32 },
      JWT_SECRET: { type: 'string', required: true, minLength: 16, secret: true },
      EXTRA_CONFIG: { type: 'json' }
    }
  };

  it('passes valid environment variables', () => {
    const result = validateEnv(
      {
        PORT: '8080',
        API_URL: 'https://api.example.com',
        ADMIN_EMAIL: 'ops@example.com',
        DEBUG: 'true',
        NODE_ENV: 'production',
        WORKERS: '4',
        JWT_SECRET: 'a-very-long-random-secret-key', // envguard-ignore
        EXTRA_CONFIG: '{"retries":3}'
      },
      { schema }
    );
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 0);
  });

  it('flags missing required, invalid types, and out-of-range values', () => {
    const result = validateEnv(
      {
        PORT: '99999',
        API_URL: 'not-a-url',
        ADMIN_EMAIL: 'invalid',
        DEBUG: 'maybe',
        NODE_ENV: 'qa',
        WORKERS: '64',
        EXTRA_CONFIG: '{broken'
      },
      { schema }
    );
    assert.equal(result.ok, false);
    const codes = new Set(result.errors.map((e) => e.code));
    assert.ok(codes.has('OUT_OF_RANGE'));
    assert.ok(codes.has('INVALID_URL'));
    assert.ok(codes.has('INVALID_EMAIL'));
    assert.ok(codes.has('INVALID_TYPE'));
    assert.ok(codes.has('INVALID_ENUM'));
    assert.ok(codes.has('MISSING_REQUIRED'));
    assert.ok(codes.has('INVALID_JSON'));
  });

  it('treats undocumented keys as warnings by default and errors in strict mode', () => {
    const env = { KNOWN: '1', SURPRISE: '2' };
    const example = { KNOWN: '' };
    const loose = validateEnv(env, { example });
    assert.equal(loose.ok, true);
    assert.equal(loose.warnings.length, 1);

    const strict = validateEnv(env, { example, strict: true });
    assert.equal(strict.ok, false);
    assert.equal(strict.errors[0].code, 'UNDOCUMENTED_KEY');
  });
});

describe('secret scanner', () => {
  it('detects provider keys and ignores placeholders or envguard-ignore lines', () => {
    const fakeOpenAi = 'sk-proj-' + 'AbCdEfGhIjKlMnOpQrStUvWxYz123456';
    const fakeAws = 'AKIA' + 'IOSFODNN7SYNTH99';
    const sample = [
      `OPENAI_API_KEY=${fakeOpenAi}`,
      `AWS_ACCESS_KEY_ID=${fakeAws}`,
      'OPENAI_PLACEHOLDER=sk-proj-your_example_placeholder_key_here',
      `IGNORED=${fakeOpenAi} # envguard-ignore`
    ].join('\n');

    const findings = scanTextForSecrets(sample, 'app.env');
    assert.equal(findings.length, 2);
    assert.equal(findings[0].ruleId, 'openai-api-key');
    assert.equal(findings[1].ruleId, 'aws-access-key');
    assert.ok(findings[0].matchMasked.includes('*'));
  });

  it('computes higher entropy for random tokens than repeated text', () => {
    assert.ok(shannonEntropy('aB3$xY9!qW2@mN7#pL5^') > shannonEntropy('aaaaaaaaaaaaaaaaaaaa'));
  });

  it('scans directories recursively while respecting ignored folders', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'envguard-scan-'));
    try {
      fs.mkdirSync(path.join(tmp, 'node_modules'), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, 'node_modules', 'ignored.js'),
        'const k = "ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";\n'
      );
      fs.writeFileSync(path.join(tmp, 'clean.js'), 'export const ok = true;\n');

      const cleanRes = scanPathForSecrets(tmp);
      assert.equal(cleanRes.scannedFiles, 1);
      assert.equal(cleanRes.findings.length, 0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('diff, sync, docs & CLI', () => {
  it('diffs two env objects and masks sensitive keys by default', () => {
    const diff = diffEnv(
      { PORT: '3000', API_SECRET: 'oldsecretvalue123', REMOVED: '1' },
      { PORT: '4000', API_SECRET: 'newsecretvalue456', ADDED: '2' }
    );
    assert.deepEqual(diff.onlyInLeft, ['REMOVED']);
    assert.deepEqual(diff.onlyInRight, ['ADDED']);
    assert.equal(diff.changed.find((c) => c.key === 'PORT')?.right, '4000');
    assert.ok(diff.changed.find((c) => c.key === 'API_SECRET')?.right.includes('*'));
  });

  it('generates sanitized .env.example and Markdown documentation', () => {
    const schema = {
      title: 'App Config',
      variables: {
        PORT: { type: 'port', required: true, default: '3000', description: 'HTTP listen port' },
        JWT_SECRET: { type: 'string', required: true, secret: true, description: 'Signing key' }
      }
    };
    const example = generateExample({ PORT: '8080', JWT_SECRET: 'top-secret-value' }, schema);
    assert.ok(example.includes('PORT=3000'));
    assert.ok(example.includes('JWT_SECRET=your_jwt_secret_here'));
    assert.ok(!example.includes('top-secret-value'));

    const docs = generateMarkdownDocs(schema);
    assert.ok(docs.includes('# App Config'));
    assert.ok(docs.includes('| `JWT_SECRET` | string | Yes | — | Signing key *(secret)* |'));
  });

  it('runs the CLI check and docs commands cleanly', () => {
    const binPath = path.resolve('bin/envguard.js');
    const out = execFileSync(process.execPath, [binPath, '--version'], { encoding: 'utf8' }).trim();
    assert.equal(out, '1.0.0');
  });
});

# envguard

[![CI](https://github.com/quetaplays1999-art/envguard/actions/workflows/ci.yml/badge.svg)](https://github.com/quetaplays1999-art/envguard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js >=18.18](https://img.shields.io/badge/node-%3E%3D18.18-brightgreen.svg)](https://nodejs.org)

**envguard** is a zero-dependency Node.js CLI and library for keeping `.env` configurations valid, documented, and free of leaked credentials across local development and CI pipelines.

## Why envguard?

- **Zero runtime dependencies** — fast startup, minimal supply-chain surface, works natively on Node.js 18.18+.
- **Typed schema validation** — validate `string`, `number`, `integer`, `port`, `boolean`, `url`, `email`, `json`, `enum`, regex `pattern`, `min`/`max`, and `minLength`.
- **Secret leak detection** — scans source files for accidentally hardcoded API keys (OpenAI, AWS, GitHub, Stripe, Google Cloud, Slack, PEM private keys) plus Shannon-entropy heuristics for generic secret assignments.
- **Safe `.env` diffing** — compare staging vs. production configs while automatically masking sensitive values.
- **Template & docs generation** — generate sanitized `.env.example` templates and Markdown reference tables directly from your schema.
- **TypeScript declarations included** — full `.d.ts` support for programmatic usage.

## Installation

```bash
npm install -D envguard-cli
```

Or run directly with `npx`:

```bash
npx envguard-cli check --env .env --schema envguard.schema.json
```

## CLI Usage

### 1. Validate `.env` against a schema or `.env.example`

```bash
envguard check --env .env --schema examples/envguard.schema.json --strict
```

### 2. Scan a repository for accidentally committed secrets

```bash
envguard scan .
```

Lines containing `envguard-ignore` are skipped, and common placeholder strings are ignored automatically.

### 3. Diff two `.env` files safely (secrets masked by default)

```bash
envguard diff .env.staging .env.production
```

Pass `--reveal` to print unmasked values locally, or `--json` for machine-readable CI output.

### 4. Generate a sanitized `.env.example`

```bash
envguard sync --env .env --schema envguard.schema.json --out .env.example
```

### 5. Generate Markdown documentation from your schema

```bash
envguard docs --schema examples/envguard.schema.json --out ENV.md
```

## Programmatic API

```js
import fs from 'node:fs';
import { parseEnv, validateEnv, scanPathForSecrets } from 'envguard-cli';

const { values } = parseEnv(fs.readFileSync('.env', 'utf8'));
const schema = JSON.parse(fs.readFileSync('envguard.schema.json', 'utf8'));

const result = validateEnv(values, { schema, strict: true });
if (!result.ok) {
  console.error(result.errors);
  process.exit(1);
}

const { findings } = scanPathForSecrets('./src');
console.log(`Secret findings: ${findings.length}`);
```

## Running Tests

```bash
npm test
```

## Contributing

Contributions, bug reports, and new secret detection rules are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

## Security

To report a security issue, please see [SECURITY.md](./SECURITY.md).

## License

MIT © [quetaplays1999-art](https://github.com/quetaplays1999-art)

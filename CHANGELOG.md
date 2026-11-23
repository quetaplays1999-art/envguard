# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-11-23

### Added
- Zero-dependency `.env` parser supporting comments, `export` prefixes, quoted/multiline values, and syntax warnings.
- Typed schema validator (`string`, `number`, `integer`, `port`, `boolean`, `url`, `email`, `json`, `enum`, `pattern`, `min`/`max`, `minLength`, and strict mode).
- Secret leak scanner with provider patterns and Shannon entropy detection.
- Masked `.env` diffing, sanitized `.env.example` generator, and Markdown table docs generator.
- CLI (`envguard check|scan|diff|sync|docs`) and full TypeScript declarations (`src/index.d.ts`).
- Automated test suite using `node:test` and GitHub Actions CI workflow.

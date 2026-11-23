# Contributing to envguard

Thanks for your interest in contributing to **envguard**!

## Development Setup

1. Ensure you have **Node.js 18.18+** (or Node.js 20/22 LTS) installed.
2. Clone the repository:
   ```bash
   git clone https://github.com/quetaplays1999-art/envguard.git
   cd envguard
   ```
3. Run the test suite:
   ```bash
   npm test
   ```

## Guidelines

- Keep runtime dependencies at **zero** (use Node.js built-in modules only).
- Add unit tests in `test/` for every bug fix, validator type, or secret rule you introduce.
- Never commit real credentials or API keys—use synthetic patterns in tests.
- Update `src/index.d.ts` and `README.md` when adding or modifying public APIs.

## Pull Request Checklist

- [ ] `npm test` passes locally.
- [ ] `node ./bin/envguard.js scan .` reports zero findings.
- [ ] Documentation and TypeScript definitions are updated if needed.

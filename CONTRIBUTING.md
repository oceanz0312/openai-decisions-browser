# Contributing

Requires Node.js 22+ and Playwright Chromium.

```bash
npm install
npm run typecheck
npm test
npm run test:e2e
```

Keep action questions in `src/questions.ts`, OpenAI wire adaptation in `src/provider.ts`, and browser control flow in `src/navigate.ts`. Never commit credentials or authenticated browser state.

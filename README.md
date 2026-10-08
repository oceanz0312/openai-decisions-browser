# OpenAI Decisions Browser

A browser-use MCP server, CLI, and TypeScript library driven by OpenAI's [Decisions API](https://developers.openai.com/api/docs/guides/decisions). It is a feature-complete derivative of `jev-browser`; the action judge has been replaced with `POST /v1/decisions`.

It does not ask the model to produce raw coordinates:

```text
Playwright extracts interactive DOM elements
→ elements receive stable candidate IDs
→ OpenAI Decisions selects one ID
→ Playwright executes the corresponding action
```

Each step sends one `choice` question for the next action and two `predicate` questions for goal completion and stuck detection. Native `<select>` controls use a second `choice` request for the option.

## Capabilities

- MCP tool: `decisions_navigate`
- CLI and library APIs
- Click, search, type, select, submit, scroll, back, and done actions
- Text, Markdown, HTML, or ARIA final-page extraction
- Auditable step traces, probabilities, console/network errors, screenshots, and optional video
- Cookie seeding and isolated password injection with redaction
- Stateless HTTP MCP transport
- Injectable decision transport for deterministic tests or gateways

## Requirements

- Node.js 22+
- `OPENAI_API_KEY`
- Access to the Decisions API and `gpt-6-luna`
- Playwright Chromium; installed automatically unless browser download is disabled

## Install and run

```bash
npm install
npm run build
OPENAI_API_KEY=... node dist/index.js
```

Codex MCP configuration:

```toml
[mcp_servers.openai-decisions-browser]
command = "npx"
args = ["-y", "openai-decisions-browser"]

[mcp_servers.openai-decisions-browser.env]
OPENAI_API_KEY = "${OPENAI_API_KEY}"
```

CLI example:

```bash
OPENAI_API_KEY=... node dist/index.js run \
  "Open the documentation page and find the Decisions model" \
  "https://developers.openai.com/api/docs/guides/decisions" \
  --format markdown --no-screenshot
```

## HTTP transport

```bash
OPENAI_API_KEY=... node dist/index.js --http
```

The default endpoint is `http://127.0.0.1:8080/mcp`. Public binds require `OPENAI_DECISIONS_BROWSER_AUTH_TOKEN`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | required | Decisions credential; also usable by the optional typing generator. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Decisions API root; `/decisions` is appended. |
| `OPENAI_DECISIONS_MODEL` | `gpt-6-luna` | Decisions model. |
| `OPENAI_DECISIONS_BROWSER_HANDOFF_DIR` | `~/.openai-decisions-browser/handoff` | Private directory for one-shot secret files. |
| `OPENAI_DECISIONS_BROWSER_PASSWORD_ORIGIN` | unset | Exact origin allowed to receive a password. |
| `OPENAI_DECISIONS_BROWSER_TYPE_PROVIDER` | auto | Optional typing provider: `openai`, `openrouter`, `anthropic`, or `google`. |
| `OPENAI_DECISIONS_BROWSER_TYPE_MODEL` | provider default | Small generative model used only to create field text. |
| `OPENAI_DECISIONS_BROWSER_AUTH_TOKEN` | unset | Bearer token required for public HTTP binds. |
| `HOST` / `PORT` | `127.0.0.1` / `8080` | HTTP bind address. |

The Decisions API chooses from supplied actions but does not generate arbitrary strings. When typing is enabled, a separate small LLM creates field contents. If none is configured, search fields use a deterministic keyword fallback and ordinary fields produce a visible degradation warning.

## Security boundaries

- URLs and pages are untrusted. Run the service in a network boundary appropriate for browser automation.
- Passwords and cookies are delivered by file/environment reference, never as MCP arguments containing their values.
- Credential runs suppress screenshots and recordings where pixels could leak secrets.
- Bot-protection pages are detected and returned as a structured `blocked` result.

## Tests

```bash
npm test
npm run test:e2e
```

The E2E case starts a local website, the real MCP stdio server, a local OpenAI-compatible Decisions endpoint, and Playwright Chromium. It verifies the full flow from DOM extraction through Decisions element selection to the final page.

## Limitations

This architecture is for browser DOM automation. It does not provide screenshot grounding for native mobile apps. Shadow DOM, cross-origin iframes, hover-only menus, arbitrary keyboard navigation, and file uploads remain limited.

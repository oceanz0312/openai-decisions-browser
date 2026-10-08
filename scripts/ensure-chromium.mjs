// Downloads Chromium for Playwright unless it is already present or the
// caller opted out. Keeps GitHub and npm installs self-contained:
// "packages everything it needs to navigate directly".
import { execFileSync } from "node:child_process";

if (process.env.OPENAI_DECISIONS_BROWSER_SKIP_BROWSER_DOWNLOAD === "1" || process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1") {
  process.exit(0);
}

try {
  execFileSync("npx", ["--yes", "playwright", "install", "chromium"], {
    stdio: "inherit",
    env: process.env,
  });
} catch (error) {
  console.error("[openai-decisions-browser] chromium install failed:", error.message);
  console.error("[openai-decisions-browser] retry manually with: npx playwright install chromium");
  process.exit(0); // not fatal: an existing system install may still work
}

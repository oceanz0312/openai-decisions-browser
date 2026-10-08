import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const serverPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function probabilities(values, selected) {
  const remaining = Math.max(1, values.length - 1);
  return values.map((value) => ({
    value,
    probability: value === selected ? 0.94 : 0.06 / remaining,
  }));
}

test("end to end: MCP navigation uses Decisions element IDs and Playwright executes them", async (t) => {
  const site = createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (req.url === "/done") {
      res.end("<!doctype html><title>Finished</title><main><h1>Task complete</h1><p id=answer>42</p></main>");
      return;
    }
    res.end("<!doctype html><title>Start</title><main><a href=/done>Continue</a></main>");
  });
  await new Promise((resolve) => site.listen(0, "127.0.0.1", resolve));
  const startUrl = `http://127.0.0.1:${site.address().port}/`;

  const decisionRequests = [];
  const openai = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw);
      decisionRequests.push({ path: req.url, body });
      const state = JSON.parse(body.input);
      const onDonePage = state.current_page.url.endsWith("/done");
      const answers = body.questions.map((question) => {
        if (question.type === "predicate") {
          const probability = question.name === "goal_done" && onDonePage ? 0.98 : 0.02;
          return { type: "predicate", name: question.name, probability };
        }
        const values = question.choices.map((choice) => choice.value);
        const selected = onDonePage
          ? "done"
          : values.find((value) => value.startsWith("click_")) ?? values[0];
        return {
          type: "choice",
          name: question.name,
          choice: selected,
          probabilities: probabilities(values, selected),
          confidence: 0.9,
        };
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: "gpt-6-luna", usage: { input_tokens: 40 }, answers }));
    });
  });
  await new Promise((resolve) => openai.listen(0, "127.0.0.1", resolve));

  const client = new Client({ name: "openai-decisions-browser-e2e", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: {
      PATH: process.env.PATH,
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: `http://127.0.0.1:${openai.address().port}/v1`,
      OPENAI_DECISIONS_MODEL: "gpt-6-luna",
    },
  });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), ["decisions_navigate"]);
    const result = await client.callTool({
      name: "decisions_navigate",
      arguments: {
        task: "Open the next page and report the answer",
        start_url: startUrl,
        max_steps: 4,
        max_seconds: 30,
        screenshot: "none",
        allow_typing: false,
      },
    }, undefined, { timeout: 45_000 });
    if (result.isError && /Executable doesn't exist/.test(result.content?.[0]?.text ?? "")) {
      t.skip("Playwright Chromium is not installed");
      return;
    }
    assert.notEqual(result.isError, true, result.content?.[0]?.text);
    const payload = JSON.parse(result.content.find((item) => item.type === "text").text);
    assert.ok(["goal_achieved", "done"].includes(payload.status));
    assert.equal(payload.final_url, `${startUrl}done`);
    assert.match(payload.page.content, /42/);
    assert.equal(payload.decisions_provider, "openai");
    assert.ok(payload.usage.decisions_calls >= 2);
    assert.equal(payload.steps[0].executed_action.startsWith("click_"), true);
  } finally {
    await client.close().catch(() => {});
    site.close();
    site.closeAllConnections();
    openai.close();
    openai.closeAllConnections();
  }

  assert.ok(decisionRequests.length >= 2);
  assert.ok(decisionRequests.every((request) => request.path === "/v1/decisions"));
  assert.ok(decisionRequests[0].body.questions.some((question) => question.type === "choice"));
  assert.ok(decisionRequests[0].body.questions.some((question) => question.type === "predicate"));
});

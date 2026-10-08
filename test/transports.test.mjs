import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { askDecisions, InvalidDecisionsAnswer, resolveTransport } from "../dist/provider.js";

const questions = {
  action: {
    type: "choice",
    instructions: "Choose the next browser action.",
    criteria: { click_e1: "Click Continue", done: "The task is complete" },
  },
  goal_done: {
    type: "noul",
    instructions: "The task is complete.",
    criteria: { true: "The goal is visibly complete", false: "More work remains" },
  },
};

async function withServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}/v1`);
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

test("OpenAI transport sends a Decisions request and maps typed answers", async () => {
  let request;
  await withServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      request = { path: req.url, authorization: req.headers.authorization, body: JSON.parse(raw) };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        model: "gpt-6-luna",
        usage: { input_tokens: 17 },
        answers: [
          {
            type: "choice",
            name: "action",
            choice: "click_e1",
            probabilities: [
              { value: "click_e1", probability: 0.9 },
              { value: "done", probability: 0.1 },
            ],
            confidence: 0.8,
          },
          { type: "predicate", name: "goal_done", probability: 0.05 },
        ],
      }));
    });
  }, async (baseUrl) => {
    const transport = resolveTransport({ OPENAI_API_KEY: "test-key", OPENAI_BASE_URL: baseUrl });
    const result = await askDecisions(transport, {
      state: { page: "fixture" },
      questions,
      model: "gpt-6-luna",
      signal: new AbortController().signal,
    });
    assert.equal(result.provider, "openai");
    assert.equal(result.answers.action.choice, "click_e1");
    assert.equal(result.answers.goal_done.noul, 0.05);
    assert.deepEqual(result.usage, { input_tokens: 17, output_tokens: 0 });
  });

  assert.equal(request.path, "/v1/decisions");
  assert.equal(request.authorization, "Bearer test-key");
  assert.equal(request.body.model, "gpt-6-luna");
  assert.deepEqual(JSON.parse(request.body.input), { page: "fixture" });
  assert.deepEqual(request.body.questions.map((question) => question.type), ["choice", "predicate"]);
});

test("custom transports remain injectable for deterministic browser tests", async () => {
  const transport = {
    name: "fixture",
    async ask() {
      return {
        answers: {
          action: { type: "choice", choice: "done", probabilities: { click_e1: 0.1, done: 0.9 }, confidence: 0.8 },
          goal_done: { type: "noul", noul: 0.95 },
        },
        usage: { input_tokens: 4, output_tokens: 0 },
        model: "fixture-model",
      };
    },
  };
  const result = await askDecisions(transport, {
    state: "fixture",
    questions,
    model: "gpt-6-luna",
    signal: new AbortController().signal,
  });
  assert.equal(result.provider, "fixture");
  assert.equal(result.model, "fixture-model");
  assert.equal(result.answers.action.choice, "done");
});

test("malformed custom answers fail closed", async () => {
  const transport = {
    name: "fixture",
    async ask() {
      return {
        answers: {
          action: { type: "choice", choice: "outside", probabilities: { click_e1: 0.1, done: 0.9 }, confidence: 0.8 },
          goal_done: { type: "noul", noul: 0.1 },
        },
        usage: { input_tokens: 1, output_tokens: 0 },
        model: "fixture-model",
      };
    },
  };
  await assert.rejects(
    () => askDecisions(transport, { state: null, questions, model: "gpt-6-luna", signal: new AbortController().signal }),
    (error) => error instanceof InvalidDecisionsAnswer && /invalid choice answer/.test(error.message),
  );
});

test("missing API credentials fail only when a decision is requested", async () => {
  const transport = resolveTransport({});
  await assert.rejects(
    () => askDecisions(transport, { state: null, questions, model: "gpt-6-luna", signal: new AbortController().signal }),
    /OPENAI_API_KEY/,
  );
});

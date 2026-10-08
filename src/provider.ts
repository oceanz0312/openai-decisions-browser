import type { DecisionQuestion } from "./questions.js";

export type DecisionsAnswer =
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number | null }
  | { type: "noul"; noul: number }
  | { type: "score"; score: number; probabilities: Record<string, number>; confidence: number | null };

export interface DecisionsTransportInput {
  state: unknown;
  questions: Record<string, unknown>;
  model: string;
  signal: AbortSignal;
}

export interface DecisionsTransportReply {
  answers: Record<string, DecisionsAnswer>;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}

export interface DecisionsTransport {
  name: string;
  ask(input: DecisionsTransportInput): Promise<DecisionsTransportReply>;
}

export interface AskResult extends DecisionsTransportReply {
  provider: string;
}

export class InvalidDecisionsAnswer extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decisionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return base.endsWith("/decisions") ? base : `${base}/decisions`;
}

function normalizeQuestion(name: string, value: unknown) {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.instructions !== "string") {
    throw new InvalidDecisionsAnswer(`question ${name}: invalid question`);
  }
  if (value.type === "choice") {
    if (!isRecord(value.criteria)) throw new InvalidDecisionsAnswer(`question ${name}: invalid choices`);
    const choices = Object.entries(value.criteria).map(([choiceValue, description]) => {
      if (typeof description !== "string") throw new InvalidDecisionsAnswer(`question ${name}: invalid choice description`);
      return { value: choiceValue, description };
    });
    return {
      source: value as unknown as DecisionQuestion,
      wire: { type: "choice", name, instructions: value.instructions, choices },
    } as const;
  }
  if (value.type === "noul") {
    if (!isRecord(value.criteria) || typeof value.criteria.true !== "string" || typeof value.criteria.false !== "string") {
      throw new InvalidDecisionsAnswer(`question ${name}: invalid predicate criteria`);
    }
    return {
      source: value as unknown as DecisionQuestion,
      wire: {
        type: "predicate",
        name,
        instructions: `${value.instructions}\n\nTrue means: ${value.criteria.true}\nFalse means: ${value.criteria.false}`,
      },
    } as const;
  }
  throw new InvalidDecisionsAnswer(`question ${name}: unsupported question type`);
}

function normalizeProbabilities(value: unknown): Record<string, number> {
  if (!Array.isArray(value)) throw new InvalidDecisionsAnswer("answer probabilities are missing");
  const probabilities: Record<string, number> = {};
  for (const item of value) {
    if (!isRecord(item) || !("value" in item) || typeof item.probability !== "number" || !Number.isFinite(item.probability)) {
      throw new InvalidDecisionsAnswer("answer probabilities are invalid");
    }
    probabilities[String(item.value)] = item.probability;
  }
  return probabilities;
}

function normalizeOpenAIAnswer(answer: unknown, question: ReturnType<typeof normalizeQuestion>): DecisionsAnswer {
  const name = question.wire.name;
  if (!isRecord(answer) || answer.name !== name || typeof answer.type !== "string") {
    throw new InvalidDecisionsAnswer(`question ${name}: missing answer`);
  }
  if (answer.type === "refusal") throw new InvalidDecisionsAnswer(`question ${name}: OpenAI refused the decision`);
  if (question.source.type === "noul") {
    if (answer.type !== "predicate" || typeof answer.probability !== "number" || answer.probability < 0 || answer.probability > 1) {
      throw new InvalidDecisionsAnswer(`question ${name}: invalid predicate answer`);
    }
    return { type: "noul", noul: answer.probability };
  }
  if (answer.type !== "choice" || typeof answer.choice !== "string") {
    throw new InvalidDecisionsAnswer(`question ${name}: invalid choice answer`);
  }
  return {
    type: "choice",
    choice: answer.choice,
    probabilities: normalizeProbabilities(answer.probabilities),
    confidence: typeof answer.confidence === "number" ? answer.confidence : null,
  };
}

function validateAnswer(name: string, answer: unknown, question: ReturnType<typeof normalizeQuestion>): DecisionsAnswer {
  if (!isRecord(answer)) throw new InvalidDecisionsAnswer(`provider question ${name}: missing answer`);
  if (question.source.type === "noul") {
    if (answer.type !== "noul" || typeof answer.noul !== "number" || answer.noul < 0 || answer.noul > 1) {
      throw new InvalidDecisionsAnswer(`provider question ${name}: invalid predicate answer`);
    }
    return answer as unknown as DecisionsAnswer;
  }
  const expected = Object.keys(question.source.criteria);
  if (answer.type !== "choice" || typeof answer.choice !== "string" || !expected.includes(answer.choice) || !isRecord(answer.probabilities)) {
    throw new InvalidDecisionsAnswer(`provider question ${name}: invalid choice answer`);
  }
  const probabilities = answer.probabilities as Record<string, unknown>;
  const keys = Object.keys(probabilities);
  if (keys.length !== expected.length || expected.some((key) => typeof probabilities[key] !== "number")) {
    throw new InvalidDecisionsAnswer(`provider question ${name}: invalid choice probabilities`);
  }
  return answer as unknown as DecisionsAnswer;
}

function createOpenAITransport(env: NodeJS.ProcessEnv): DecisionsTransport {
  const url = decisionsUrl(env.OPENAI_BASE_URL || "https://api.openai.com/v1");
  return {
    name: "openai",
    async ask(input) {
      const apiKey = env.OPENAI_API_KEY?.trim();
      if (!apiKey) throw new Error("OPENAI_API_KEY is required for OpenAI Decisions");
      const questions = Object.entries(input.questions).map(([name, question]) => normalizeQuestion(name, question));
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(env.OPENAI_ORG_ID ? { "OpenAI-Organization": env.OPENAI_ORG_ID } : {}),
          ...(env.OPENAI_PROJECT_ID ? { "OpenAI-Project": env.OPENAI_PROJECT_ID } : {}),
        },
        body: JSON.stringify({
          model: input.model,
          input: typeof input.state === "string" ? input.state : JSON.stringify(input.state),
          questions: questions.map((question) => question.wire),
        }),
        signal: input.signal,
      });
      const raw = await response.text();
      if (!response.ok) {
        const safe = raw.split(apiKey).join("[redacted]").slice(0, 500);
        throw new Error(`OpenAI Decisions request failed with HTTP ${response.status}: ${safe}`);
      }
      let body: Record<string, unknown>;
      try {
        const parsed = JSON.parse(raw);
        if (!isRecord(parsed)) throw new Error("response is not an object");
        body = parsed;
      } catch (error) {
        throw new Error(`OpenAI Decisions returned invalid JSON: ${(error as Error).message}`);
      }
      if (!Array.isArray(body.answers)) throw new InvalidDecisionsAnswer("OpenAI Decisions response is missing answers");
      const byName = new Map<string, unknown>();
      for (const answer of body.answers) {
        if (isRecord(answer) && typeof answer.name === "string") byName.set(answer.name, answer);
      }
      const answers: Record<string, DecisionsAnswer> = {};
      for (const question of questions) {
        answers[question.wire.name] = normalizeOpenAIAnswer(byName.get(question.wire.name), question);
      }
      const usage = isRecord(body.usage) ? body.usage : {};
      return {
        answers,
        usage: {
          input_tokens: typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
          output_tokens: 0,
        },
        model: typeof body.model === "string" && body.model ? body.model : input.model,
      };
    },
  };
}

export function resolveTransport(env: NodeJS.ProcessEnv = process.env): DecisionsTransport {
  return createOpenAITransport(env);
}

export async function askDecisions(transport: DecisionsTransport, input: DecisionsTransportInput): Promise<AskResult> {
  let reply: DecisionsTransportReply;
  try {
    reply = await transport.ask(input);
  } catch (error) {
    if (input.signal.aborted) throw input.signal.reason;
    throw error;
  }
  if (!isRecord(reply) || !isRecord(reply.answers) || !isRecord(reply.usage)) {
    throw new InvalidDecisionsAnswer(`provider ${transport.name} question <response>: invalid response`);
  }
  if (typeof reply.usage.input_tokens !== "number" || reply.usage.input_tokens < 0 || typeof reply.usage.output_tokens !== "number" || reply.usage.output_tokens < 0) {
    throw new InvalidDecisionsAnswer(`provider ${transport.name} question <response>: invalid usage`);
  }
  if (typeof reply.model !== "string" || !reply.model.trim()) {
    throw new InvalidDecisionsAnswer(`provider ${transport.name} question <response>: invalid model`);
  }
  const normalizedQuestions = Object.entries(input.questions).map(([name, question]) => [name, normalizeQuestion(name, question)] as const);
  const answers: Record<string, DecisionsAnswer> = {};
  for (const [name, question] of normalizedQuestions) answers[name] = validateAnswer(name, reply.answers[name], question);
  const provider = typeof transport.name === "string" && transport.name.trim() ? transport.name : "unknown";
  return { answers, usage: reply.usage, provider, model: reply.model };
}

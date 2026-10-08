// The Decisions question catalog — every question in one place. The provider
// translates these compact internal shapes to OpenAI predicate/choice questions.

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export interface PredicateQuestion {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
}

export type DecisionQuestion = ChoiceQuestion | PredicateQuestion;

function choice(instructions: string, criteria: Record<string, string>): ChoiceQuestion {
  return { type: "choice", instructions, criteria };
}

function noul(instructions: string, criteria: { true: string; false: string }): PredicateQuestion {
  return { type: "noul", instructions, criteria };
}

/**
 * The primary Decisions call for each step: three independent judgments over the
 * same state. A select action adds one second-stage call for its option (see
 * selectOptionQuestion), so "one call per step" means one primary call.
 * OpenAI evaluates the independent questions against shared input. Questions
 * cannot see each other's answers, which makes goal_done an honest
 * cross-check on the action Choice rather than a rationalization of it.
 */
export function stepQuestions(criteria: Record<string, string>) {
  return {
    action: choice("Which single action best advances the task on the current page?", criteria),
    goal_done: noul("The task's goal has been achieved: the current page and history show the sought outcome", {
      true: "The page being viewed is the sought destination or shows the sought information",
      false: "The goal is not yet achieved",
    }),
    stuck: noul("The actions so far are not making progress toward the task (repeats, loops, or no change)", {
      true: "Recent actions repeat or nothing changes; a different strategy is needed",
      false: "Progress is visible or the first steps are still reasonable",
    }),
  };
}

/**
 * Second stage for native <select> elements, asked only when the step Choice
 * picked select_eN. Option labels are the defined set; Decisions picks the value.
 * The second request keeps the primary action space compact.
 */
export function selectOptionQuestion(elementDescription: string, options: string[]) {
  const criteria: Record<string, string> = {};
  options.forEach((label, i) => {
    criteria[`o${i}`] = label.slice(0, 80);
  });
  return choice(
    `Which option should be selected in the dropdown "${elementDescription}", given the task and the page?`,
    criteria,
  );
}

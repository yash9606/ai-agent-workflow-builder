/**
 * Safe resolution of conditional_branch jump targets.
 * No user-supplied code evaluation — only next / end / step UUID / position.
 */

export interface BranchableStep {
  id: string;
  position: number;
}

export interface ResolveBranchOptions {
  steps: BranchableStep[];
  currentIndex: number;
  matched: boolean;
  trueNext?: string;
  falseNext?: string;
  /** Legacy: when condition is false, skip all remaining steps. */
  skipOnFalse?: boolean;
}

export interface ResolveBranchResult {
  /** Absolute index of the next step to execute (or steps.length if ending). */
  nextIndex: number;
  /** When true, remaining steps after the branch are skipped and the run completes. */
  endRun: boolean;
  target: string;
}

function normalizeTarget(raw: string | undefined, fallback: string): string {
  const value = (raw ?? fallback).trim();
  return value.length > 0 ? value : fallback;
}

/**
 * Resolve where execution continues after a conditional_branch step.
 * Only forward jumps are allowed (prevents loops).
 */
export function resolveBranchNextIndex(
  options: ResolveBranchOptions
): ResolveBranchResult {
  const { steps, currentIndex, matched, skipOnFalse } = options;

  if (currentIndex < 0 || currentIndex >= steps.length) {
    throw new Error("conditional_branch currentIndex out of range");
  }

  const fallbackFalse = skipOnFalse ? "end" : "next";
  const target = matched
    ? normalizeTarget(options.trueNext, "next")
    : normalizeTarget(options.falseNext, fallbackFalse);

  if (target === "next" || target === "__continue__") {
    return {
      nextIndex: currentIndex + 1,
      endRun: false,
      target: "next",
    };
  }

  if (target === "end" || target === "__end__") {
    return {
      nextIndex: steps.length,
      endRun: true,
      target: "end",
    };
  }

  let jumpIndex = steps.findIndex((s) => s.id === target);
  if (jumpIndex < 0) {
    const asPos = Number(target);
    if (Number.isInteger(asPos)) {
      jumpIndex = steps.findIndex((s) => s.position === asPos);
    }
  }

  if (jumpIndex < 0) {
    throw new Error(
      `conditional_branch target "${target}" does not match a step id or position`
    );
  }

  if (jumpIndex <= currentIndex) {
    throw new Error(
      "conditional_branch only allows forward jumps (no loops)"
    );
  }

  return {
    nextIndex: jumpIndex,
    endRun: false,
    target,
  };
}

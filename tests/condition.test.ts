import { describe, expect, it } from "vitest";
import { evaluateCondition } from "@/lib/executor/condition";

describe("evaluateCondition", () => {
  it("selects positive path when LLM text contains POSITIVE", () => {
    const result = evaluateCondition({
      data: { text: "POSITIVE" },
      field: "text",
      operator: "contains",
      value: "POSITIVE",
      trueLabel: "positive_path",
      falseLabel: "negative_path",
    });
    expect(result.matched).toBe(true);
    expect(result.label).toBe("positive_path");
  });

  it("selects negative path when LLM text is NEGATIVE", () => {
    const result = evaluateCondition({
      data: { text: "NEGATIVE" },
      field: "text",
      operator: "contains",
      value: "POSITIVE",
      trueLabel: "positive_path",
      falseLabel: "negative_path",
    });
    expect(result.matched).toBe(false);
    expect(result.label).toBe("negative_path");
  });

  it("supports eq/neq/gt/lt/exists without executing user code", () => {
    expect(
      evaluateCondition({ data: { n: 5 }, field: "n", operator: "eq", value: 5 })
        .matched
    ).toBe(true);
    expect(
      evaluateCondition({ data: { n: 5 }, field: "n", operator: "neq", value: 1 })
        .matched
    ).toBe(true);
    expect(
      evaluateCondition({ data: { n: 5 }, field: "n", operator: "gt", value: 3 })
        .matched
    ).toBe(true);
    expect(
      evaluateCondition({ data: { n: 5 }, field: "n", operator: "lt", value: 3 })
        .matched
    ).toBe(false);
    expect(
      evaluateCondition({ data: { a: 1 }, field: "a", operator: "exists" }).matched
    ).toBe(true);
    expect(
      evaluateCondition({ data: {}, field: "missing", operator: "exists" }).matched
    ).toBe(false);
  });
});

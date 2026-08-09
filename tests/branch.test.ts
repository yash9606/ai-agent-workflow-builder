import { describe, expect, it } from "vitest";
import { resolveBranchNextIndex } from "@/lib/executor/branch";

const steps = [
  { id: "s0", position: 0 },
  { id: "s1", position: 1 },
  { id: "s2", position: 2 },
  { id: "s3", position: 3 },
];

describe("resolveBranchNextIndex", () => {
  it("continues linearly on true_next=next", () => {
    const r = resolveBranchNextIndex({
      steps,
      currentIndex: 1,
      matched: true,
      trueNext: "next",
      falseNext: "s3",
    });
    expect(r.nextIndex).toBe(2);
    expect(r.endRun).toBe(false);
  });

  it("jumps forward to a step UUID on false path", () => {
    const r = resolveBranchNextIndex({
      steps,
      currentIndex: 1,
      matched: false,
      trueNext: "next",
      falseNext: "s3",
    });
    expect(r.nextIndex).toBe(3);
    expect(r.endRun).toBe(false);
  });

  it("ends the run when target is end", () => {
    const r = resolveBranchNextIndex({
      steps,
      currentIndex: 1,
      matched: false,
      falseNext: "end",
    });
    expect(r.nextIndex).toBe(4);
    expect(r.endRun).toBe(true);
  });

  it("honors skip_on_false legacy flag", () => {
    const r = resolveBranchNextIndex({
      steps,
      currentIndex: 1,
      matched: false,
      skipOnFalse: true,
    });
    expect(r.endRun).toBe(true);
  });

  it("rejects backward jumps", () => {
    expect(() =>
      resolveBranchNextIndex({
        steps,
        currentIndex: 2,
        matched: true,
        trueNext: "s0",
      })
    ).toThrow(/forward/);
  });
});

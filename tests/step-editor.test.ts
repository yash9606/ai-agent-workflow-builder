import { describe, expect, it } from "vitest";
import { defaultConfigForType } from "@/components/workflow/StepEditor";

describe("defaultConfigForType", () => {
  it("includes branch jump targets for conditional steps", () => {
    const config = defaultConfigForType("conditional_branch");
    expect(config.true_next).toBe("next");
    expect(config.false_next).toBe("next");
    expect(config.operator).toBe("eq");
  });

  it("uses controlled key-only config for db_write", () => {
    const config = defaultConfigForType("db_write");
    expect(config).toEqual({ key: "result" });
    expect(Object.keys(config)).not.toContain("sql");
  });
});

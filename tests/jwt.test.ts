import { describe, expect, it } from "vitest";
import { signDemoJwt, verifyHasuraJwt } from "@/lib/auth/jwt";
import { DEMO_USERS } from "@/lib/types";

describe("demo JWT", () => {
  it("signs and verifies Hasura claims with user id", async () => {
    const alice = DEMO_USERS["alice@org-a.demo"];
    const token = await signDemoJwt(alice.id, alice.email);
    const claims = await verifyHasuraJwt(token);
    expect(claims.userId).toBe(alice.id);
    expect(claims.defaultRole).toBe("user");
  });
});

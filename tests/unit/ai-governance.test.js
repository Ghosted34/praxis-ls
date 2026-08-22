"use strict";
const {
  estimateCostNative,
  capState,
  canUse,
} = require("../../src/modules/ai/governance/governance.rules");

describe("AI governance rules", () => {
  test("estimateCostNative from tokens + audio × vendor rate", () => {
    const vendor = {
      cost_per_1k_input_tokens: 2,
      cost_per_1k_output_tokens: 4,
      cost_per_audio_minute: 10,
    };
    // 2000 in => 2*2=4; 1000 out => 1*4=4; 120s=2min => 2*10=20; total 28
    expect(
      estimateCostNative({
        inputTokens: 2000,
        outputTokens: 1000,
        audioSeconds: 120,
        vendor,
      }),
    ).toBe(28);
  });
  test("capState OK / WARN / BLOCK", () => {
    const caps = { soft_cap_xaf: 100, hard_cap_xaf: 200 };
    expect(capState(50, caps)).toBe("OK");
    expect(capState(150, caps)).toBe("WARN");
    expect(capState(200, caps)).toBe("BLOCK");
    expect(capState(9999, {})).toBe("OK"); // no caps set
  });
  test("canUse composes flag + grant + budget", () => {
    const flag = { is_enabled: true };
    const grant = { revoked_at: null };
    expect(canUse({ flag, grant, budgetState: "OK" }).allowed).toBe(true);
    expect(canUse({ flag, grant, budgetState: "WARN" }).allowed).toBe(true);
    expect(canUse({ flag, grant, budgetState: "BLOCK" }).allowed).toBe(false);
    expect(
      canUse({ flag: { is_enabled: false }, grant, budgetState: "OK" }).allowed,
    ).toBe(false);
    expect(
      canUse({ flag, grant: { revoked_at: "2026-01-01" }, budgetState: "OK" })
        .allowed,
    ).toBe(false);
    expect(canUse({ flag, grant: null, budgetState: "OK" }).allowed).toBe(
      false,
    );
  });
});

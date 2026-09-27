/**
 * The keep-alive hang-up (calls audit A10) posts to a URL built from the same
 * helper as `hangupCall`, and that URL is one the backend router serves. The
 * old hand-written `/api/tenant/comms/calls/:id/hangup` did not exist, so a
 * closed tab left the call open for 30 minutes.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { callHangupPath, callHangupUrl } from "./smartcomm-api";

describe("the hang-up URL", () => {
  it("is the tenant API prefix plus the path hangupCall uses", () => {
    expect(callHangupPath("c1")).toBe("/smartcomm/calls/c1/hangup");
    expect(callHangupUrl("c1")).toBe("/api/tenant/smartcomm/calls/c1/hangup");
  });

  it("matches a route the backend actually serves", () => {
    const routes = fs.readFileSync(
      path.resolve(__dirname, "../../../src/modules/smartcomm/smartcomm.routes.js"),
      "utf8",
    );
    expect(routes).toMatch(/basePath:\s*"\/smartcomm"/);
    expect(routes).toMatch(/router\.post\("\/calls\/:id\/hangup"/);
  });
});

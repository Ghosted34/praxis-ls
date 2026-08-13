"use strict";

/**
 * API F-6 / F-9 — the boot guard against two modules serving the same URL.
 *
 * History, because it is the point of the test:
 *
 *   The first version of this guard rejected any duplicate `basePath`. Three
 *   modules legitimately share "/" — app_user (/users, /auth), workflow
 *   (/workflows) and treasury_account (/treasury-accounts) — so boot threw, the
 *   API container never became healthy, and the deploy failed at the standby
 *   roll. A guard meant to prevent an outage caused one.
 *
 *   The audit had already said so: API F-9, "three modules claim the tenant
 *   root". It was read and not connected.
 *
 * The invariant that actually matters is not "no shared prefix" but "no two
 * modules answer the same METHOD + PATH" — because that is when one silently
 * shadows the other while enforcing a different permission module. These tests
 * pin both halves: the legitimate sharing must pass, the real collision must
 * fail.
 */

const express = require("express");
const { routeKeys } = require("../../src/shared/http/module-loader");

/** Mirrors the collision check inside mountTenantModules, on synthetic routers. */
function check(modules) {
  const byRoute = new Map();
  for (const { name, basePath, router } of modules) {
    for (const key of routeKeys(router, basePath === "/" ? "" : basePath)) {
      const prior = byRoute.get(key);
      if (prior) {
        throw new Error(
          `Duplicate tenant route "${key}": mounted by both ${prior} and ${name}.`,
        );
      }
      byRoute.set(key, name);
    }
  }
  return byRoute;
}

describe("routeKeys — resolves real URLs, including nested sub-routers", () => {
  it("prefixes routes with a nested router's mount path", () => {
    // app_user's shape: one module, two sub-routers, mounted at "/".
    const users = express.Router();
    users.get("/", () => {});
    users.patch("/:id", () => {});
    const auth = express.Router();
    auth.post("/login", () => {});
    const root = express.Router();
    root.use("/users", users);
    root.use("/auth", auth);

    expect(routeKeys(root).sort()).toEqual(
      ["GET /users/", "PATCH /users/:id", "POST /auth/login"].sort(),
    );
  });

  it("applies the module basePath", () => {
    const r = express.Router();
    r.get("/:id/qa", () => {});
    expect(routeKeys(r, "/inbound")).toEqual(["GET /inbound/:id/qa"]);
  });
});

describe("boot guard", () => {
  it("ALLOWS three modules sharing '/' with disjoint URLs — the regression", () => {
    // This exact configuration crashed the API container on 2026-08-04.
    const appUser = express.Router();
    const u = express.Router();
    u.get("/", () => {});
    const a = express.Router();
    a.post("/login", () => {});
    appUser.use("/users", u);
    appUser.use("/auth", a);

    const workflow = express.Router();
    workflow.get("/workflows", () => {});

    const treasury = express.Router();
    treasury.get("/treasury-accounts", () => {});

    expect(() =>
      check([
        { name: "security/app_user", basePath: "/", router: appUser },
        { name: "workflow/workflow", basePath: "/", router: workflow },
        { name: "master/treasury_account", basePath: "/", router: treasury },
      ]),
    ).not.toThrow();
  });

  it("ALLOWS a shared basePath while the path sets stay disjoint", () => {
    // The pre-move /inbound situation: wrong, but not a shadowing bug yet.
    const sales = express.Router();
    sales.get("/enquiries", () => {});
    const wms = express.Router();
    wms.get("/", () => {});
    wms.post("/:id/qa", () => {});

    expect(() =>
      check([
        { name: "sales/inbound_intake", basePath: "/inbound", router: sales },
        { name: "wms/inbound", basePath: "/inbound", router: wms },
      ]),
    ).not.toThrow();
  });

  it("THROWS when two modules answer the same method + path", () => {
    // The hazard F-6 describes: the day either module adds the other's route.
    const sales = express.Router();
    sales.get("/:id", () => {});
    const wms = express.Router();
    wms.get("/:id", () => {});

    expect(() =>
      check([
        { name: "sales/inbound_intake", basePath: "/inbound", router: sales },
        { name: "wms/inbound", basePath: "/inbound", router: wms },
      ]),
    ).toThrow(/Duplicate tenant route "GET \/inbound\/:id"/);
  });

  it("does NOT confuse different methods on the same path", () => {
    const a = express.Router();
    a.get("/thing", () => {});
    const b = express.Router();
    b.post("/thing", () => {});
    expect(() =>
      check([
        { name: "mod/a", basePath: "/x", router: a },
        { name: "mod/b", basePath: "/x", router: b },
      ]),
    ).not.toThrow();
  });

  it("names both modules in the error, so the fix is obvious", () => {
    const a = express.Router();
    a.get("/dup", () => {});
    const b = express.Router();
    b.get("/dup", () => {});
    expect(() =>
      check([
        { name: "group/alpha", basePath: "/", router: a },
        { name: "group/beta", basePath: "/", router: b },
      ]),
    ).toThrow(/group\/alpha and group\/beta/);
  });
});

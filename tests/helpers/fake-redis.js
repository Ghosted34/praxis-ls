"use strict";

/**
 * A small in-memory Redis for unit tests (CI's build-test job has no Redis).
 *
 * It implements only the commands the calls code uses, with Redis's own
 * semantics for each (string values, expiry in ms, sorted sets by score).
 * `multi()` queues commands and `exec()` returns `[[null, result], ...]` like
 * ioredis; `watch()` is accepted and always succeeds, since one process runs
 * everything here. `now` can be moved to test expiry without real waiting.
 *
 * `fail = true` makes every command reject, to test the Redis-down paths.
 */
function createFakeRedis({ now = () => Date.now() } = {}) {
  const strings = new Map();
  const zsets = new Map();
  const sets = new Map();
  const expiry = new Map();
  const state = { fail: false, calls: [] };

  const alive = (k) => {
    const at = expiry.get(k);
    if (at !== undefined && at <= now()) {
      strings.delete(k); zsets.delete(k); sets.delete(k); expiry.delete(k);
    }
    return strings.has(k) || zsets.has(k) || sets.has(k);
  };
  const z = (k) => { alive(k); if (!zsets.has(k)) zsets.set(k, new Map()); return zsets.get(k); };
  const s = (k) => { alive(k); if (!sets.has(k)) sets.set(k, new Set()); return sets.get(k); };
  const num = (v) => (v === "-inf" ? -Infinity : v === "+inf" ? Infinity : Number(v));
  const dropEmpty = (k) => {
    if (zsets.has(k) && zsets.get(k).size === 0) { zsets.delete(k); expiry.delete(k); }
    if (sets.has(k) && sets.get(k).size === 0) { sets.delete(k); expiry.delete(k); }
  };

  const cmds = {
    get: (k) => (alive(k) ? strings.get(k) : null),
    mget: (...ks) => ks.flat().map((k) => (alive(k) ? strings.get(k) : null)),
    set: (k, v, ...opts) => {
      const up = opts.map((o) => String(o).toUpperCase());
      if (up.includes("NX") && alive(k)) return null;
      if (up.includes("XX") && !alive(k)) return null;
      strings.set(k, String(v));
      expiry.delete(k);
      const ex = up.indexOf("EX");
      const px = up.indexOf("PX");
      if (ex >= 0) expiry.set(k, now() + Number(opts[ex + 1]) * 1000);
      if (px >= 0) expiry.set(k, now() + Number(opts[px + 1]));
      return "OK";
    },
    del: (...ks) => ks.flat().reduce((n, k) => {
      const had = alive(k);
      strings.delete(k); zsets.delete(k); sets.delete(k); expiry.delete(k);
      return n + (had ? 1 : 0);
    }, 0),
    exists: (...ks) => ks.flat().filter((k) => alive(k)).length,
    incr: (k) => cmds.incrby(k, 1),
    incrby: (k, by) => {
      const v = Number(alive(k) ? strings.get(k) : 0) + Number(by);
      strings.set(k, String(v));
      return v;
    },
    expire: (k, sec) => (alive(k) ? (expiry.set(k, now() + Number(sec) * 1000), 1) : 0),
    pexpire: (k, ms) => (alive(k) ? (expiry.set(k, now() + Number(ms)), 1) : 0),
    pttl: (k) => (!alive(k) ? -2 : expiry.has(k) ? expiry.get(k) - now() : -1),
    zadd: (k, ...args) => {
      const m = z(k);
      let added = 0;
      for (let i = 0; i + 1 < args.length; i += 2) {
        if (!m.has(String(args[i + 1]))) added += 1;
        m.set(String(args[i + 1]), Number(args[i]));
      }
      return added;
    },
    zrem: (k, ...ms) => {
      const m = z(k);
      const n = ms.flat().filter((x) => m.delete(String(x))).length;
      dropEmpty(k);
      return n;
    },
    zscore: (k, member) => {
      const v = z(k).get(String(member));
      dropEmpty(k);
      return v === undefined ? null : String(v);
    },
    zcard: (k) => { const n = z(k).size; dropEmpty(k); return n; },
    zcount: (k, min, max) => {
      const n = [...z(k).values()].filter((v) => v >= num(min) && v <= num(max)).length;
      dropEmpty(k);
      return n;
    },
    zremrangebyscore: (k, min, max) => {
      const m = z(k);
      let n = 0;
      for (const [member, v] of m) if (v >= num(min) && v <= num(max)) { m.delete(member); n += 1; }
      dropEmpty(k);
      return n;
    },
    zrange: (k, start, stop, withScores) => {
      const sorted = [...z(k).entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
      dropEmpty(k);
      const end = Number(stop) < 0 ? sorted.length + Number(stop) : Number(stop);
      const slice = sorted.slice(Number(start), end + 1);
      return withScores ? slice.flatMap(([m, v]) => [m, String(v)]) : slice.map(([m]) => m);
    },
    zrangebyscore: (k, min, max) => [...z(k).entries()]
      .filter(([, v]) => v >= num(min) && v <= num(max))
      .sort((a, b) => a[1] - b[1])
      .map(([m]) => m),
    sadd: (k, ...ms) => { const st = s(k); return ms.flat().filter((m) => !st.has(String(m)) && st.add(String(m))).length; },
    srem: (k, ...ms) => { const st = s(k); const n = ms.flat().filter((m) => st.delete(String(m))).length; dropEmpty(k); return n; },
    smembers: (k) => { const out = [...s(k)]; dropEmpty(k); return out; },
    scard: (k) => { const n = s(k).size; dropEmpty(k); return n; },
    watch: () => "OK",
    unwatch: () => "OK",
  };

  const client = {
    _state: state,
    _dump: () => ({ strings, zsets, sets, expiry }),
    _reset: () => {
      strings.clear(); zsets.clear(); sets.clear(); expiry.clear();
      state.fail = false; state.calls.length = 0;
    },
  };
  for (const [name, fn] of Object.entries(cmds)) {
    client[name] = async (...args) => {
      state.calls.push(name);
      if (state.fail) throw new Error("fake redis: connection refused");
      return fn(...args);
    };
  }
  const batch = () => {
    const queued = [];
    const b = {};
    for (const [name, fn] of Object.entries(cmds)) {
      b[name] = (...args) => { queued.push([name, fn, args]); return b; };
    }
    b.exec = async () => {
      if (state.fail) throw new Error("fake redis: connection refused");
      return queued.map(([name, fn, args]) => { state.calls.push(name); return [null, fn(...args)]; });
    };
    return b;
  };
  client.multi = batch;
  client.pipeline = batch;
  return client;
}

module.exports = { createFakeRedis };

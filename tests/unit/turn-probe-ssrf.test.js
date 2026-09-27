"use strict";

/**
 * The relay host is operator-supplied: it comes from the platform console's
 * Call relay card and from `.env`. "Press Test" is therefore a request to
 * send a UDP packet to a name somebody typed, and without a guard that is a
 * port scanner with a button — point it at 169.254.169.254 and read whether
 * cloud metadata answers.
 *
 * The ranges refused here are the ones coturn's own entrypoint denies as
 * peers (calls audit C1). The two lists are deliberately the same shape: the
 * relay must not reach the host's private services, and neither must the
 * thing that tests the relay.
 */
const probe = require("../../src/services/platform/turn-probe");
const { assertProbeableHost } = probe._test;

describe("addresses a relay probe refuses", () => {
  it.each([
    ["loopback", "127.0.0.1"],
    ["cloud metadata", "169.254.169.254"],
    ["the Docker bridge", "172.17.0.1"],
    ["RFC 1918 (10/8)", "10.0.0.1"],
    ["RFC 1918 (192.168/16)", "192.168.1.1"],
    ["carrier-grade NAT", "100.64.0.1"],
    ["IETF protocol assignments", "192.0.0.1"],
    ["benchmarking", "198.18.0.1"],
    ["multicast", "224.0.0.1"],
    ["IPv6 loopback", "::1"],
    ["IPv6 unique-local", "fd00::1"],
    ["IPv6 link-local", "fe80::1"],
    ["an IPv4 private address wearing an IPv6 hat", "::ffff:10.0.0.1"],
  ])("refuses %s", (_label, ip) => {
    expect(probe.isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    ["a public IPv4", "8.8.8.8"],
    ["a documentation address (public-shaped)", "203.0.113.10"],
    ["a public IPv6", "2001:4860:4860::8888"],
  ])("allows %s", (_label, ip) => {
    expect(probe.isBlockedAddress(ip)).toBe(false);
  });

  it("refuses anything it cannot parse as an address, rather than guessing", () => {
    expect(probe.isBlockedAddress("")).toBe(true);
    expect(probe.isBlockedAddress("not-an-address")).toBe(true);
    expect(probe.isBlockedAddress(null)).toBe(true);
  });
});

describe("the host check", () => {
  it("passes a public literal through", async () => {
    await expect(assertProbeableHost("203.0.113.10")).resolves.toEqual(["203.0.113.10"]);
  });

  it("refuses a private literal with a message naming the address", async () => {
    await expect(assertProbeableHost("169.254.169.254")).rejects.toThrow(/169\.254\.169\.254/);
  });

  /**
   * Every address, not the first: a name answering with one public and one
   * private address is the DNS-rebinding shape, and taking the public one
   * would send the packet to whichever the OS picked anyway.
   */
  it("refuses a name that resolves to a mix of public and private", async () => {
    const dns = require("dns").promises;
    const spy = jest.spyOn(dns, "lookup").mockResolvedValue([
      { address: "203.0.113.10", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    try {
      await expect(assertProbeableHost("rebind.example")).rejects.toThrow(/10\.0\.0\.5/);
    } finally {
      spy.mockRestore();
    }
  });

  it("allows a name that resolves only to public addresses", async () => {
    const dns = require("dns").promises;
    const spy = jest.spyOn(dns, "lookup").mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
    try {
      await expect(assertProbeableHost("relay.example")).resolves.toEqual(["203.0.113.10"]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("the packet goes to the checked address, not the name", () => {
  /**
   * Resolving once and sending to the result closes the gap between the
   * check and the send: a name that answers publicly here and privately a
   * millisecond later cannot move the target, because by then the target is
   * already an address.
   */
  it("sends to the resolved address rather than the hostname", async () => {
    const dnsp = require("dns").promises;
    const dgram = require("dgram");
    const lookup = jest.spyOn(dnsp, "lookup").mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
    const sent = [];
    const sock = { send: (_b, _p, addr) => sent.push(addr), on: () => {}, close: () => {} };
    const create = jest.spyOn(dgram, "createSocket").mockReturnValue(sock);
    try {
      // Awaiting the call itself rather than sleeping: it resolves on its own
      // timeout, and the send has necessarily happened by then.
      await probe.allocate({ host: "relay.example", port: 3478, label: "l", mac: "m", timeoutMs: 5 });
      expect(sent).toContain("203.0.113.10");
      expect(sent).not.toContain("relay.example");
    } finally {
      lookup.mockRestore();
      create.mockRestore();
    }
  });
});

describe("allocate refuses before it sends anything", () => {
  it("returns BLOCKED_ADDRESS rather than opening a socket", async () => {
    const dgram = require("dgram");
    const spy = jest.spyOn(dgram, "createSocket");
    try {
      const out = await probe.allocate({ host: "169.254.169.254", port: 3478, label: "l", mac: "m" });
      expect(out).toMatchObject({ ok: false, code: "BLOCKED_ADDRESS" });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

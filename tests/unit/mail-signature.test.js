/**
 * Signature resolution, blank-safety, HTML/PNG parity, promotion invalidation
 * and history immutability.
 *
 * The HTML is what leaves the building as the company. A dangling separator or
 * a person's mobile on an OTP is the class of defect a customer screenshots.
 */
"use strict";

const resolve = require("../../src/modules/mail/signature/signature.resolve");
const html = require("../../src/modules/mail/signature/signature.html");
const png = require("../../src/modules/mail/signature/signature.png");
const service = require("../../src/modules/mail/signature/signature.service");

const employee = {
  full_name: "Marie Nguema",
  job_title: "Operations Officer",
  department: "Operations",
};
const entity = {
  legal_name: "Smart Logistics SARL",
  legal_form: "SARL",
  share_capital: "100 000 000",
  share_capital_currency: "XAF",
  rccm: "RC/DLA/2014/B/1234",
  niu: "M123456789",
  address_line: "Bonanjo",
  po_box: "BP 123",
  city: "Douala",
  country: "CM",
  phone: "+237 233 00 00 00",
  website: "www.smartlogistics.cm",
  logo_url: "https://cdn.example.com/logo.png",
};
const profile = {
  phone_desk: "+237 233 11 11 11",
  phone_mobile: "+237 6 00 00 00 00",
  whatsapp: "+237 6 00 00 00 00",
  pronouns: "she/her",
  credentials: "FIATA Dip.",
};
const template = {
  key: "smartls_classic",
  layout: { kind: "classic", show_logo: true, show_motto_bar: true, show_legal: false, brand_color: "#0f4c81" },
  copy_en: { motto: "Moving cargo. Moving Africa.", confidentiality: "Confidential." },
  copy_fr: { motto: "Faire bouger le fret.", confidentiality: "Confidentiel." },
};

function model(over = {}) {
  return resolve.resolve({
    employee, entity, profile, template,
    mailbox: { email_address: "marie@smartlogistics.cm" },
    ...over,
  }, over.lang || "en");
}

describe("resolution and blank-safety", () => {
  test("a user with no profile still gets every derived field", () => {
    const m = resolve.resolve({
      employee, entity, profile: {}, template,
      mailbox: { email_address: "marie@smartlogistics.cm" },
    }, "en");
    expect(m.person.full_name).toBe("Marie Nguema");
    expect(m.person.job_title).toBe("Operations Officer");
    expect(m.contact.email).toBe("marie@smartlogistics.cm");
    expect(m.company.legal_name).toBe("Smart Logistics SARL");
    expect(m.contact.phone_desk).toBeNull();
    expect(m.contact.phone_mobile).toBeNull();
    const out = html.render(m);
    expect(out).toMatch(/Marie Nguema/);
    expect(out).not.toMatch(/ · · /);
    expect(out).not.toMatch(/T null|undefined/);
  });

  test("a missing P.O. Box does not leave a dangling separator", () => {
    const m = resolve.resolve({
      employee, template, profile: {},
      entity: { ...entity, po_box: null, address_line: "Bonanjo", city: "Douala" },
      mailbox: { email_address: "marie@smartlogistics.cm" },
    }, "en");
    expect(m.company.address_line).toMatch(/^Bonanjo, Douala/);
    expect(m.company.address_line).not.toMatch(/,\s*,/);
    expect(m.company.address_line).not.toMatch(/BP/);
  });

  test("job title is derived, never taken from the profile", () => {
    const m = resolve.resolve({
      employee: { ...employee, job_title: "Director of Operations" },
      profile: { ...profile, job_title: "Intern" },
      entity, template,
      mailbox: { email_address: "marie@smartlogistics.cm" },
    }, "en");
    expect(m.person.job_title).toBe("Director of Operations");
  });

  test("French copy is used when the language is fr", () => {
    const m = model({ lang: "fr" });
    expect(m.company.motto).toMatch(/Afrique|fret/);
    expect(html.render(m)).toMatch(/Faire bouger/);
  });
});

describe("system vs named-user identity", () => {
  test("a SYSTEM OTP block carries the corporate identity and no person's mobile", () => {
    const m = resolve.resolve({
      employee, profile, entity, template,
      identity: { purpose: "NOTIFICATIONS", from_address: "no-reply@smartlogistics.cm" },
      system: true,
    }, "en");
    expect(m.person.full_name).toBeNull();
    expect(m.contact.phone_mobile).toBeNull();
    expect(m.person.department).toBeNull(); // NOTIFICATIONS is the minimal strip
    const out = html.render(m);
    expect(out).not.toMatch(/Marie/);
    expect(out).not.toMatch(/6 00 00 00 00/);
    expect(out).toMatch(/Smart Logistics/);
  });

  test("BILLING system mail is labelled Billing / Facturation", () => {
    expect(resolve.departmentLabel("BILLING", "en")).toBe("Billing");
    expect(resolve.departmentLabel("BILLING", "fr")).toBe("Facturation");
    const m = resolve.resolve({
      entity, template,
      identity: { purpose: "BILLING", from_address: "billing@smartlogistics.cm" },
      system: true,
    }, "fr");
    expect(m.person.department).toBe("Facturation");
  });
});

describe("email-safe HTML", () => {
  const out = html.render(model());

  test("no <style> block, no class, no flex/grid/variables", () => {
    expect(out).not.toMatch(/<style/i);
    expect(out).not.toMatch(/class=/i);
    expect(out).not.toMatch(/display\s*:\s*(flex|grid)/i);
    expect(out).not.toMatch(/var\(--/);
  });

  test("layout is a presentational table and the logo is display:block with width", () => {
    expect(out).toMatch(/<table[^>]*role="presentation"/);
    expect(out).toMatch(/src="https:\/\/cdn\.example\.com\/logo\.png"/);
    expect(out).toMatch(/display:block/);
    expect(out).toMatch(/width="96"/);
  });

  test("typed markup in a name is escaped", () => {
    const m = resolve.resolve({
      employee: { full_name: "<script>x</script>", job_title: "Ops" },
      entity, template, mailbox: { email_address: "a@b.cm" },
    }, "en");
    const rendered = html.render(m);
    expect(rendered).not.toMatch(/<script/i);
    expect(rendered).toMatch(/&lt;script&gt;/);
  });

  test("a javascript: booking URL is refused", () => {
    const m = resolve.resolve({
      employee, entity, template,
      profile: { booking_url: "javascript:alert(1)" },
      mailbox: { email_address: "a@b.cm" },
    }, "en");
    expect(m.contact.booking_url).toBeNull();
    expect(html.render(m)).not.toMatch(/javascript:/i);
  });
});

describe("HTML / PNG parity", () => {
  test("the same model produces identical text in HTML and PNG paths", async () => {
    const m = model();
    const fromHtml = html.textContent(m);
    const shot = async () => Buffer.from("fake-png");
    const fromPng = await png.render(m, 2, shot);
    expect(fromPng.text).toBe(fromHtml);
    expect(fromHtml).toMatch(/Marie Nguema/);
    expect(fromHtml).toMatch(/Operations Officer/);
    expect(fromHtml).toMatch(/marie@smartlogistics\.cm/);
  });

  test("PNG at 2× is 1300 × 650", () => {
    const d = png.dimensions({ width_px: 650, height_px: 325 }, 2);
    expect(d).toMatchObject({ width: 1300, height: 650, scale: 2 });
  });

  test("the screenshot is asked for the HTML of THIS model, not a different one", async () => {
    const m = model();
    let seen = null;
    await png.render(m, 1, async (pageHtml) => {
      seen = pageHtml;
      return Buffer.from("x");
    });
    expect(seen).toMatch(/Marie Nguema/);
    expect(seen).toMatch(/Moving cargo/);
  });
});

describe("promotion invalidation and history immutability", () => {
  test("source_hash changes when job_title changes, and not when it does not", () => {
    const a = resolve.sourceHash({ employee: { job_title: "Officer" }, language: "en" });
    const b = resolve.sourceHash({ employee: { job_title: "Director" }, language: "en" });
    const c = resolve.sourceHash({ employee: { job_title: "Officer" }, language: "en" });
    expect(a).not.toBe(b);
    expect(a).toBe(c);
  });

  test("bake appends to the body being queued and does not mutate a stored message", () => {
    const original = "<html><body><p>Invoice attached</p></body></html>";
    const frozen = original;
    const baked = service.bake(original, "Invoice attached", {
      html: "<table>sig</table>", text: "Marie Nguema",
    });
    expect(frozen).toBe("<html><body><p>Invoice attached</p></body></html>");
    expect(baked.html).toMatch(/Invoice attached/);
    expect(baked.html).toMatch(/sig/);
    expect(baked.text).toMatch(/Invoice attached/);
    expect(baked.text).toMatch(/Marie Nguema/);
    expect(baked.text).toMatch(/^[\s\S]*-- /);
  });

  test("a disabled profile bakes nothing", () => {
    const baked = service.bake("<p>Hi</p>", "Hi", { disabled: true, html: "<table>sig</table>" });
    expect(baked.html).toBe("<p>Hi</p>");
  });
});

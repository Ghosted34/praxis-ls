/**
 * WHAT IS MISSING FROM A SIGNATURE, AND WHERE TO GO AND FIX IT — PURE.
 *
 * THE PROBLEM. Almost every field on the card is derived: the name and title
 * from HR, the address and P.O. Box from `entity_address`, the website and
 * phone from `corporate_entity`, the logo from Appearance, the motto from the
 * template. That is the right design — a promotion reaches every future
 * signature with nobody remembering to update anything — and it has one cost:
 * when a field is blank, the person looking at the gap is usually not the
 * person who can fill it, and has no idea which of five screens it lives on.
 *
 * The old answer was a sentence on the settings page saying company details
 * "come from your company profile". True, and useless: the P.O. Box is a dozen
 * inputs down a form on a tab of a dossier the reader has never opened.
 *
 * So each gap carries the route, the tab and the field that fills it, and the
 * UI renders that as a link. The three surfaces are genuinely different pages —
 * this module is where that knowledge lives, once, instead of being spread
 * across the components that happen to display a gap.
 *
 * WHY THE ROUTES ARE HERE AND NOT IN THE CLIENT. The gap list is computed from
 * the resolved model, which only the server has. Returning a gap without its
 * destination would just move the "which screen?" problem to the frontend, and
 * a route table duplicated on both sides is a route table that drifts when
 * someone renames a tab.
 */
"use strict";

/**
 * Where each derived field is edited.
 *
 * `tab` and `field` are consumed by the `?tab=`/`?field=` handling on the two
 * 360 dossiers. `scope` decides who is even shown the link: a member of staff
 * with no MOD-70 or MOD-02 grant cannot act on a company gap, and offering them
 * a link into a page they will be refused is worse than saying who to ask.
 */
const SOURCES = {
  // ── The person. Their own record, via the self-service surface. ──
  full_name: {
    label: "Name",
    scope: "hr",
    owner: "HR",
    route: "/hr/employees",
    hint: "Your name comes from your staff record.",
  },
  job_title: {
    label: "Job title",
    scope: "hr",
    owner: "HR",
    route: "/hr/employees",
    hint: "Your job title comes from your staff record.",
  },
  phone_desk: {
    label: "Desk phone",
    scope: "self",
    owner: "you",
    route: "/comms/signatures",
    hint: "You can set this yourself.",
  },
  phone_mobile: {
    label: "Mobile",
    scope: "self",
    owner: "you",
    route: "/comms/signatures",
    hint: "You can set this yourself.",
  },
  email: {
    label: "Email address",
    scope: "hr",
    owner: "HR",
    route: "/hr/employees",
    hint: "Taken from the mailbox you send from, or your staff record.",
  },

  // ── The company. Three different surfaces, which is the whole point. ──
  legal_name: {
    label: "Company name",
    scope: "entity",
    owner: "an administrator",
    route: "/master/corporate-entities",
    hint: "Set on the corporate entity.",
  },
  address_line: {
    label: "Street address",
    scope: "entity",
    owner: "an administrator",
    route: "/master/corporate-entities/:entityId",
    tab: "Contacts & addresses",
    field: "line1",
    hint: "Add a REGISTERED address on the entity.",
  },
  po_box: {
    label: "P.O. Box",
    scope: "entity",
    owner: "an administrator",
    route: "/master/corporate-entities/:entityId",
    tab: "Contacts & addresses",
    field: "po_box",
    hint: "Part of the entity's registered address.",
  },
  website: {
    label: "Website",
    scope: "entity",
    owner: "an administrator",
    route: "/master/corporate-entities",
    field: "website",
    hint: "Set on the corporate entity.",
  },
  logo: {
    label: "Logo",
    scope: "brand",
    owner: "an administrator",
    route: "/settings/appearance",
    field: "logo_url",
    hint: "Your brand logo, used across the product.",
  },
  motto: {
    label: "Motto",
    scope: "template",
    owner: "an administrator",
    route: "/comms/signatures",
    tab: "Templates",
    hint: "Authored on the signature template, per language.",
  },
};

/** Substitute the ids a route needs. A route with an unfilled `:param` is not
 *  a link — it is a 404 — so it degrades to the list page instead. */
function href(source, { entityId = null } = {}) {
  let route = source.route;
  if (route.includes(":entityId")) {
    if (!entityId) return route.replace("/:entityId", "");
    route = route.replace(":entityId", entityId);
  }
  const q = [];
  if (source.tab) q.push(`tab=${encodeURIComponent(source.tab)}`);
  if (source.field) q.push(`field=${encodeURIComponent(source.field)}`);
  return q.length ? `${route}?${q.join("&")}` : route;
}

/**
 * Which fields the model is missing, each with where to fix it.
 *
 * `can` is the caller's grants — `{ hr, entity, brand, template }` — and decides
 * whether a gap gets a link or a "ask X" note. It is NOT a security boundary:
 * the destination screens enforce their own permissions. It exists so the list
 * reads as useful rather than as ten links to pages that will refuse you.
 *
 * @param {object} model    a resolved signature model
 * @param {object} [can]    { hr, entity, brand, template } booleans
 * @returns {Array<{key,label,owner,hint,href,actionable}>}
 */
function gaps(model, can = {}) {
  if (!model) return [];
  const p = model.person || {};
  const c = model.contact || {};
  const co = model.company || {};
  const entityId = model.entity_id || null;

  // A SYSTEM block carries no person, so a missing name is not a gap there.
  const missing = [];
  const add = (key, isMissing) => { if (isMissing) missing.push(key); };

  if (!model.system) {
    add("full_name", !p.full_name);
    add("job_title", !p.job_title);
    add("phone_desk", !c.phone_desk);
    add("phone_mobile", !c.phone_mobile);
  }
  add("email", !c.email);
  add("legal_name", !co.legal_name);
  add("address_line", !co.street_line && !co.address_line);
  add("po_box", !co.po_box_line);
  add("website", !co.website);
  add("logo", !co.logo_data && !co.logo_url);
  add("motto", !co.motto);

  return missing.map((key) => {
    const src = SOURCES[key];
    const actionable = can[src.scope] === true || src.scope === "self";
    return {
      key,
      label: src.label,
      owner: src.owner,
      hint: src.hint,
      scope: src.scope,
      // No link for a gap the caller cannot act on: it would land them on a
      // permission error, which reads as the product being broken rather than
      // as "this is not yours to fix".
      href: actionable ? href(src, { entityId }) : null,
      actionable,
    };
  });
}

module.exports = { gaps, href, SOURCES };

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

// Node builtin. Explicit rather than global: the backend lint env does not
// declare browser globals, and this file is required by the API and the tests.
const { URLSearchParams } = require("url");

/**
 * Where each derived field is edited.
 *
 * `tab` and `field` are consumed by the `?tab=`/`?field=` handling on the two
 * 360 dossiers. `scope` decides who is even shown the link: a member of staff
 * with no MOD-70 or MOD-02 grant cannot act on a company gap, and offering them
 * a link into a page they will be refused is worse than saying who to ask.
 */
/**
 * Where each derived field is edited — precisely enough to LAND ON THE CONTROL.
 *
 * THE RULE THIS ENCODES: exact field, or no link at all. A link that lands you
 * on a list and leaves you to find the entity again is worse than a sentence
 * telling you where to look, because it costs a page load to learn it was not
 * going to help. Every entry below either reaches a focused input or it carries
 * `where` instead of a route, and `href()` refuses to invent the difference.
 *
 * THE URL CONTRACT, honoured by the four screens named here:
 *
 *   ?tab=<Tab>            which tab of a dossier                (useUrlTab)
 *   ?focus=<id>           which record a list screen has open   (useRecordParam)
 *   ?edit=<what>          which modal to open on arrival        (useDeepLinkEdit)
 *   ?row=<id|new>         which row that modal edits, or `new`  (useDeepLinkEdit)
 *   ?field=<anchor>       the control to focus and ring         (useFieldHighlight)
 *
 * `edit`/`row` are stripped when the modal closes, so dismissing a dialog and
 * refreshing does not put it straight back.
 *
 * `needs` names the id the route cannot be built without. If the model does not
 * carry it, there is no link — see `href()`.
 */
const SOURCES = {
  // ── The person. Their own staff record, in the HR dossier. ──
  full_name: {
    label: "Name",
    scope: "hr",
    owner: "HR",
    route: "/hr/employees",
    needs: "employeeId",
    focus: "employeeId",
    edit: "employee",
    field: "full_name",
    hint: "Opens your staff record with the name field focused.",
    where: "HR → Employees → your record → Edit employee",
  },
  job_title: {
    label: "Job title",
    scope: "hr",
    owner: "HR",
    route: "/hr/employees",
    needs: "employeeId",
    focus: "employeeId",
    edit: "employee",
    field: "job_title",
    hint: "Opens your staff record with the job title focused.",
    where: "HR → Employees → your record → Edit employee",
  },
  email: {
    label: "Email address",
    scope: "hr",
    owner: "HR",
    route: "/hr/employees",
    needs: "employeeId",
    focus: "employeeId",
    edit: "employee",
    field: "email",
    hint: "Taken from the mailbox you send from, or your staff record.",
    where: "HR → Employees → your record → Edit employee",
  },

  // ── The person's own numbers. Theirs to set, on the tab they are already on. ──
  phone_desk: {
    label: "Desk phone",
    scope: "self",
    owner: "you",
    route: "/comms/signatures",
    field: "phone_desk",
    hint: "You can set this yourself, right here.",
    where: "Comms → Signatures → My signature",
  },
  phone_mobile: {
    label: "Mobile",
    scope: "self",
    owner: "you",
    route: "/comms/signatures",
    field: "phone_mobile",
    hint: "You can set this yourself, right here.",
    where: "Comms → Signatures → My signature",
  },

  // ── The company. `legal_name` and `website` are entity SCALARS, and the
  //    dossier only displays them — the form that edits them lives on the list
  //    screen, which already opens it from `?edit=`. That is why these two
  //    point at the list WITH the entity named, and not at the dossier.
  legal_name: {
    label: "Company name",
    scope: "entity",
    owner: "an administrator",
    route: "/master/corporate-entities",
    needs: "entityId",
    edit: "entity",
    row: "entityId",
    field: "legal_name",
    hint: "Opens the entity's details with the name focused.",
    where: "Master data → Corporate entities → your entity → Edit",
  },
  website: {
    label: "Website",
    scope: "entity",
    owner: "an administrator",
    route: "/master/corporate-entities",
    needs: "entityId",
    edit: "entity",
    row: "entityId",
    field: "website",
    hint: "Opens the entity's details with the website focused.",
    where: "Master data → Corporate entities → your entity → Edit",
  },

  // ── The registered address. A COLLECTION row on the dossier, edited in a
  //    modal — so the link names the row, or `new` when there is none to edit.
  address_line: {
    label: "Street address",
    scope: "entity",
    owner: "an administrator",
    route: "/master/corporate-entities/:entityId",
    needs: "entityId",
    tab: "Contacts & addresses",
    edit: "addresses",
    row: "addressId",
    field: "line1",
    hint: "Opens the registered address with the street line focused.",
    where: "Master data → Corporate entities → your entity → Contacts & addresses",
  },
  po_box: {
    label: "P.O. Box",
    scope: "entity",
    owner: "an administrator",
    route: "/master/corporate-entities/:entityId",
    needs: "entityId",
    tab: "Contacts & addresses",
    edit: "addresses",
    row: "addressId",
    field: "po_box",
    hint: "Opens the registered address with the P.O. Box focused.",
    where: "Master data → Corporate entities → your entity → Contacts & addresses",
  },

  // ── Not a blank field, but the wrong company. See `gaps()`. ──
  entity_link: {
    label: "Your staff record names no company",
    scope: "hr",
    owner: "HR",
    route: "/hr/employees",
    needs: "employeeId",
    focus: "employeeId",
    edit: "employee",
    field: "entity_id",
    hint: "The card is using the oldest company on file. Link your record to the right one.",
    where: "HR → Employees → your record → Edit employee",
  },

  // ── Brand and template. ──
  logo: {
    label: "Logo",
    scope: "brand",
    owner: "an administrator",
    route: "/settings/appearance",
    field: "logo",
    hint: "Your brand logo, used across the product.",
    where: "Settings → Appearance → Logo",
  },
  motto: {
    label: "Motto",
    scope: "template",
    owner: "an administrator",
    route: "/comms/signatures",
    tab: "Templates",
    // `needs`, so this never degrades to `row=new`: a motto is authored ON the
    // active template, and "create a template" is not what a missing motto asks
    // for. No resolved template, no link.
    needs: "templateId",
    edit: "motto",
    row: "templateId",
    field: "motto",
    hint: "Authored on the signature template, per language.",
    where: "Comms → Signatures → Templates",
  },
};

/**
 * Build the link, or return null.
 *
 * NULL IS A FIRST-CLASS ANSWER HERE. The old version degraded a route it could
 * not complete — `/master/corporate-entities/:entityId` with no id became
 * `/master/corporate-entities`, the list — which is precisely the behaviour
 * that made "click Website" land nowhere useful. A half-resolved route is not a
 * cheaper link, it is a promise the destination cannot keep, so it is not
 * offered: the caller renders `where` as text instead.
 *
 * @param {object} source  an entry from SOURCES
 * @param {object} ids     { entityId, employeeId, addressId, templateId }
 * @returns {string|null}
 */
function href(source, ids = {}) {
  // The one id this route cannot be built without. No id, no link.
  if (source.needs && !ids[source.needs]) return null;

  let route = source.route;
  if (route.includes(":entityId")) {
    if (!ids.entityId) return null;
    route = route.replace(":entityId", encodeURIComponent(ids.entityId));
  }

  const q = new URLSearchParams();
  if (source.tab) q.set("tab", source.tab);
  if (source.focus) {
    if (!ids[source.focus]) return null;
    q.set("focus", ids[source.focus]);
  }
  if (source.edit) {
    q.set("edit", source.edit);
    if (source.row) {
      // `new` is a real destination, not a failure: "there is no registered
      // address" is fixed by creating one, and the modal opens blank for it.
      q.set("row", ids[source.row] || "new");
    }
  }
  if (source.field) q.set("field", source.field);

  const qs = q.toString();
  return qs ? `${route}?${qs}` : route;
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
function gaps(model, can = {}, opts = {}) {
  if (!model) return [];
  const p = model.person || {};
  const c = model.contact || {};
  const co = model.company || {};

  // Every id a route might need, resolved once. A missing one costs a link,
  // never a wrong destination — see `href()`.
  const ids = {
    entityId: model.entity_id || null,
    employeeId: p.employee_id || null,
    addressId: co.address_id || null,
    templateId: opts.templateId || model.template_id || null,
  };

  const missing = [];
  const add = (key, isMissing) => { if (isMissing) missing.push(key); };

  // A SYSTEM block carries no person, so a missing name is not a gap there.
  if (!model.system) {
    add("full_name", !p.full_name);
    add("job_title", !p.job_title);
    add("phone_desk", !c.phone_desk);
    add("phone_mobile", !c.phone_mobile);
    // NOT a blank field — a WRONG one, which is worse because it looks fine.
    // The card printed a company the sender is not recorded as working for,
    // because their staff record names no entity and the resolver fell back to
    // the oldest active one. On a single-entity tenant that is right by luck;
    // on a group it puts the flagship's address on a subsidiary's mail.
    add("entity_link", model.entity_source === "fallback" && Boolean(co.legal_name));
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
    // Two independent reasons there may be no link, and they mean different
    // things to the reader: `actionable` is "not yours to fix", a null href is
    // "we cannot land you on the control". `where` covers both, so a gap
    // without a link still says exactly where the field lives.
    const link = actionable ? href(src, ids) : null;
    return {
      key,
      label: src.label,
      owner: src.owner,
      hint: src.hint,
      scope: src.scope,
      where: src.where || null,
      href: link,
      actionable,
      // The panel renders a link OR a path, never a link that half-works.
      precise: Boolean(link),
    };
  });
}

module.exports = { gaps, href, SOURCES };

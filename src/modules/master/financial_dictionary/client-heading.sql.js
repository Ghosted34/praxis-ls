/**
 * THE CLIENT HEADING — one definition of how a dictionary line's family is read.
 *
 * A client document (quotation, final invoice) prints one line per family —
 * "Customs Formalities", "Port & Terminal Charges" — instead of the costing's
 * detail (14130; tenant review "meeting 5"). The family is, in order:
 *
 *   1. the document line's own `client_heading` override (free text), when the
 *      pricer set one for this file;
 *   2. the dictionary line's default heading (`client_heading_ref_id`, a
 *      dictionary_ref row of kind CLIENT_HEADING — bilingual);
 *   3. "Other Charges".
 *
 * This fragment is step 2 for SQL readers; `resolveHeading` in
 * services/documents/templates/client-headings.js applies the whole order.
 *
 * Usage: `… LEFT JOIN dictionary_item di … ${clientHeadingJoin("di")}` then
 * select `${CLIENT_HEADING_COLUMNS}`.
 */
"use strict";

const IDENT = /^[a-z_][a-z0-9_]*$/i;

function clientHeadingJoin(itemAlias = "di", alias = "chd") {
  if (!IDENT.test(itemAlias) || !IDENT.test(alias)) throw new Error("clientHeadingJoin: bad alias");
  return `LEFT JOIN dictionary_ref ${alias} ON ${alias}.ref_id = ${itemAlias}.client_heading_ref_id AND ${alias}.kind = 'CLIENT_HEADING'`;
}

function clientHeadingColumns(alias = "chd") {
  if (!IDENT.test(alias)) throw new Error("clientHeadingColumns: bad alias");
  return `${alias}.code AS client_heading_code, ${alias}.name_fr AS client_heading_fr, ` +
    `${alias}.name_en AS client_heading_en, ${alias}.sort_order AS client_heading_sort`;
}

const CLIENT_HEADING_COLUMNS = clientHeadingColumns("chd");

module.exports = { clientHeadingJoin, clientHeadingColumns, CLIENT_HEADING_COLUMNS };

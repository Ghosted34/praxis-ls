/**
 * Tenant rows → compact text "cards" for semantic recall. Runs on a tenant
 * connection already bound to live/sandbox. Only knowledge-bearing entities;
 * exact/current values come from function-calling, not from these cards.
 * Each card carries a confidentiality tag so retrieval can filter per RBAC.
 */
"use strict";

// [sql, mapRow→card] per entity. Defensive: LIMIT and only-if-table-exists.
const BUILDERS = [
  {
    key: "dossier",
    sql: `SELECT d.ref, d.status, d.incoterm, d.pol, d.pod, c.name AS client
            FROM dossier d LEFT JOIN client_master c ON c.client_id = d.client_id
           ORDER BY d.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `dossier:${r.ref}`,
      title: `Operation file ${r.ref}`,
      confidentiality: "normal",
      text: `Operation file ${r.ref} for client ${r.client || "?"} — status ${r.status}, incoterm ${r.incoterm || "?"}, route ${r.pol || "?"}→${r.pod || "?"}.`,
    }),
  },
  {
    key: "client_master",
    sql: `SELECT ref, name, niu, payment_terms_days FROM client_master ORDER BY created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `client:${r.ref || r.name}`,
      title: `Client ${r.name}`,
      confidentiality: "normal",
      text: `Client ${r.name} (ref ${r.ref || "?"}, NIU ${r.niu || "?"}), payment terms ${r.payment_terms_days || "?"} days.`,
    }),
  },
  {
    key: "dictionary_item",
    sql: `SELECT code, label_fr, label_en, category, is_disbursement FROM dictionary_item ORDER BY code LIMIT $1`,
    card: (r) => ({
      ref: `dict:${r.code}`,
      title: `Dictionary item ${r.code}`,
      confidentiality: "normal",
      text: `Billing item ${r.code}: ${r.label_en || r.label_fr} (${r.category}${r.is_disbursement ? ", débours" : ""}).`,
    }),
  },
  // ── Expanded entity coverage ──
  // THE BREADTH FIX. The AI's knowledge base only covered 3 entity types, so
  // retrieval grounding was thin — the vector search covered docs and schema
  // but very few actual business records. These additions cover the high-value
  // entities the assistant is most often asked about.
  {
    key: "final_invoice",
    sql: `SELECT i.invoice_id, i.doc_number, i.status, i.total_ttc, c.name AS client, i.issued_at
            FROM final_invoice i LEFT JOIN client_master c ON c.client_id = i.client_id
           ORDER BY i.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `invoice:${r.doc_number || r.invoice_id}`,
      title: `Invoice ${r.doc_number || "draft"}`,
      confidentiality: "normal",
      text: `Invoice ${r.doc_number || "draft"} for ${r.client || "?"} — status ${r.status}, total ${r.total_ttc || 0} XAF${r.issued_at ? `, issued ${new Date(r.issued_at).toLocaleDateString()}` : ""}.`,
    }),
  },
  {
    key: "quotation",
    sql: `SELECT q.quotation_id, q.doc_number, q.status, q.total_ttc, c.name AS client
            FROM quotation q LEFT JOIN client_master c ON c.client_id = q.client_id
           ORDER BY q.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `quotation:${r.doc_number || r.quotation_id}`,
      title: `Quotation ${r.doc_number || "draft"}`,
      confidentiality: "normal",
      text: `Quotation ${r.doc_number || "draft"} for ${r.client || "?"} — status ${r.status}, total ${r.total_ttc || 0} XAF.`,
    }),
  },
  {
    key: "supplier_master",
    sql: `SELECT ref, name, niu FROM supplier_master ORDER BY created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `supplier:${r.ref || r.name}`,
      title: `Supplier ${r.name}`,
      confidentiality: "normal",
      text: `Supplier ${r.name} (ref ${r.ref || "?"}, NIU ${r.niu || "?"}).`,
    }),
  },
  {
    key: "purchase_order",
    sql: `SELECT po.po_id, po.doc_number, po.status, s.name AS supplier, po.total_ttc
            FROM purchase_order po LEFT JOIN supplier_master s ON s.supplier_id = po.supplier_id
           ORDER BY po.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `purchase_order:${r.doc_number || r.po_id}`,
      title: `Purchase Order ${r.doc_number || "draft"}`,
      confidentiality: "normal",
      text: `Purchase order ${r.doc_number || "draft"} from ${r.supplier || "?"} — status ${r.status}, total ${r.total_ttc || 0} XAF.`,
    }),
  },
  {
    key: "employee",
    sql: `SELECT employee_id, full_name, position, department, status FROM employee ORDER BY created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `employee:${r.full_name}`,
      title: `Employee ${r.full_name}`,
      confidentiality: "confidential",
      text: `Employee ${r.full_name} — ${r.position || "?"}, ${r.department || "?"} department, status ${r.status || "active"}.`,
    }),
  },
  {
    key: "vehicle",
    sql: `SELECT vehicle_id, plate, make, model, status, vehicle_type FROM vehicle ORDER BY created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `vehicle:${r.plate}`,
      title: `Vehicle ${r.plate}`,
      confidentiality: "normal",
      text: `Vehicle ${r.plate} — ${r.make || ""} ${r.model || ""} (${r.vehicle_type || "?"}), status ${r.status || "?"}.`,
    }),
  },
  {
    key: "proforma",
    sql: `SELECT p.proforma_id, p.doc_number, p.status, p.total_ttc, c.name AS client
            FROM proforma p LEFT JOIN client_master c ON c.client_id = p.client_id
           ORDER BY p.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `proforma:${r.doc_number || r.proforma_id}`,
      title: `Proforma ${r.doc_number || "draft"}`,
      confidentiality: "normal",
      text: `Proforma invoice ${r.doc_number || "draft"} for ${r.client || "?"} — status ${r.status}, total ${r.total_ttc || 0} XAF.`,
    }),
  },
  {
    key: "supplier_invoice",
    sql: `SELECT si.supplier_invoice_id, si.doc_number, si.status, si.total_ttc, s.name AS supplier
            FROM supplier_invoice si LEFT JOIN supplier_master s ON s.supplier_id = si.supplier_id
           ORDER BY si.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `supplier_invoice:${r.doc_number || r.supplier_invoice_id}`,
      title: `Supplier Invoice ${r.doc_number || "draft"}`,
      confidentiality: "normal",
      text: `Supplier invoice ${r.doc_number || "draft"} from ${r.supplier || "?"} — status ${r.status}, total ${r.total_ttc || 0} XAF.`,
    }),
  },
  {
    key: "lead",
    sql: `SELECT lead_id, company_name, contact_name, status, source FROM lead ORDER BY created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `lead:${r.company_name || r.contact_name}`,
      title: `Lead ${r.company_name || r.contact_name}`,
      confidentiality: "normal",
      text: `Lead: ${r.company_name || "?"} (contact ${r.contact_name || "?"}), source ${r.source || "?"}, status ${r.status || "?"}.`,
    }),
  },
  {
    key: "opportunity",
    sql: `SELECT o.opportunity_id, o.title, o.status, o.expected_value, c.name AS client
            FROM opportunity o LEFT JOIN client_master c ON c.client_id = o.client_id
           ORDER BY o.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `opportunity:${r.title}`,
      title: `Opportunity ${r.title}`,
      confidentiality: "normal",
      text: `Opportunity "${r.title}" with ${r.client || "?"} — status ${r.status}, expected value ${r.expected_value || 0} XAF.`,
    }),
  },
  // ── Operations & logistics ──
  {
    key: "costing",
    sql: `SELECT c.costing_id, c.status, c.total_revenue, c.total_cost, c.margin_pct, d.ref AS dossier_ref
            FROM costing c LEFT JOIN dossier d ON d.dossier_id = c.dossier_id
           ORDER BY c.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `costing:${r.costing_id}`,
      title: `Costing for ${r.dossier_ref || "dossier"}`,
      confidentiality: "confidential",
      text: `Costing for dossier ${r.dossier_ref || "?"} — status ${r.status}, revenue ${r.total_revenue || 0} XAF, cost ${r.total_cost || 0} XAF, margin ${r.margin_pct || 0}%.`,
    }),
  },
  {
    key: "transit_order",
    sql: `SELECT transit_order_id, ref, status, transport_mode, pol, pod, etd, eta
            FROM transit_order ORDER BY created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `transit:${r.ref}`,
      title: `Transit Order ${r.ref}`,
      confidentiality: "normal",
      text: `Transit order ${r.ref} — ${r.transport_mode || "?"}, ${r.pol || "?"}→${r.pod || "?"}, status ${r.status}${r.etd ? `, ETD ${new Date(r.etd).toLocaleDateString()}` : ""}${r.eta ? `, ETA ${new Date(r.eta).toLocaleDateString()}` : ""}.`,
    }),
  },
  {
    key: "delivery_note",
    sql: `SELECT dn.delivery_note_id, dn.doc_number, dn.status, dn.delivery_date, c.name AS client
            FROM delivery_note dn LEFT JOIN client_master c ON c.client_id = dn.client_id
           ORDER BY dn.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `delivery_note:${r.doc_number || r.delivery_note_id}`,
      title: `Delivery Note ${r.doc_number || "draft"}`,
      confidentiality: "normal",
      text: `Delivery note ${r.doc_number || "draft"} for ${r.client || "?"} — status ${r.status}${r.delivery_date ? `, delivered ${new Date(r.delivery_date).toLocaleDateString()}` : ""}.`,
    }),
  },
  {
    key: "milestone",
    sql: `SELECT m.milestone_id, m.title, m.status, m.due_date, d.ref AS dossier_ref
            FROM milestone m LEFT JOIN dossier d ON d.dossier_id = m.dossier_id
           ORDER BY m.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `milestone:${r.title}`,
      title: `Milestone: ${r.title}`,
      confidentiality: "normal",
      text: `Milestone "${r.title}" on dossier ${r.dossier_ref || "?"} — status ${r.status}${r.due_date ? `, due ${new Date(r.due_date).toLocaleDateString()}` : ""}.`,
    }),
  },
  // ── Procurement ──
  {
    key: "purchase_request",
    sql: `SELECT pr.purchase_request_id, pr.doc_number, pr.status, pr.requested_by, pr.total_ttc
            FROM purchase_request pr ORDER BY pr.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `purchase_request:${r.doc_number || r.purchase_request_id}`,
      title: `Purchase Request ${r.doc_number || "draft"}`,
      confidentiality: "normal",
      text: `Purchase request ${r.doc_number || "draft"} by ${r.requested_by || "?"} — status ${r.status}, total ${r.total_ttc || 0} XAF.`,
    }),
  },
  {
    key: "goods_received_note",
    sql: `SELECT grn.goods_received_note_id, grn.doc_number, grn.status, grn.received_date, s.name AS supplier
            FROM goods_received_note grn LEFT JOIN supplier_master s ON s.supplier_id = grn.supplier_id
           ORDER BY grn.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `grn:${r.doc_number || r.goods_received_note_id}`,
      title: `GRN ${r.doc_number || "draft"}`,
      confidentiality: "normal",
      text: `Goods received note ${r.doc_number || "draft"} from ${r.supplier || "?"} — status ${r.status}${r.received_date ? `, received ${new Date(r.received_date).toLocaleDateString()}` : ""}.`,
    }),
  },
  // ── Finance ──
  {
    key: "cash_request",
    sql: `SELECT cr.cash_request_id, cr.status, cr.total_amount, cr.requested_by, d.ref AS dossier_ref
            FROM cash_request cr LEFT JOIN dossier d ON d.dossier_id = cr.dossier_id
           ORDER BY cr.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `cash_request:${r.cash_request_id}`,
      title: `Cash Request`,
      confidentiality: "confidential",
      text: `Cash request for dossier ${r.dossier_ref || "?"} — status ${r.status}, amount ${r.total_amount || 0} XAF, requested by ${r.requested_by || "?"}.`,
    }),
  },
  {
    key: "journal_entry",
    sql: `SELECT je.journal_entry_id, je.entry_ref, je.status, je.entry_date, je.total_debit, je.description
            FROM journal_entry je ORDER BY je.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `journal_entry:${r.entry_ref || r.journal_entry_id}`,
      title: `Journal Entry ${r.entry_ref || "draft"}`,
      confidentiality: "confidential",
      text: `Journal entry ${r.entry_ref || "draft"} — ${r.description || "no description"}, status ${r.status}, total debit ${r.total_debit || 0} XAF${r.entry_date ? `, dated ${new Date(r.entry_date).toLocaleDateString()}` : ""}.`,
    }),
  },
  {
    key: "tax_declaration",
    sql: `SELECT td.tax_declaration_id, td.doc_number, td.status, td.tax_period, td.total_tax_due
            FROM tax_declaration td ORDER BY td.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `tax_declaration:${r.doc_number || r.tax_declaration_id}`,
      title: `Tax Declaration ${r.doc_number || "draft"}`,
      confidentiality: "confidential",
      text: `Tax declaration ${r.doc_number || "draft"} for period ${r.tax_period || "?"} — status ${r.status}, tax due ${r.total_tax_due || 0} XAF.`,
    }),
  },
  {
    key: "asset",
    sql: `SELECT a.asset_id, a.name, a.status, a.acquisition_cost, a.net_book_value, a.category
            FROM asset a ORDER BY a.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `asset:${r.name}`,
      title: `Asset: ${r.name}`,
      confidentiality: "confidential",
      text: `Fixed asset "${r.name}" (${r.category || "?"}) — status ${r.status}, acquisition cost ${r.acquisition_cost || 0} XAF, net book value ${r.net_book_value || 0} XAF.`,
    }),
  },
  {
    key: "debt_engagement",
    sql: `SELECT d.debt_id, d.reference, d.status, d.principal_amount, d.outstanding_balance, d.lender
            FROM debt_engagement d ORDER BY d.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `debt:${r.reference || r.debt_id}`,
      title: `Debt: ${r.reference}`,
      confidentiality: "confidential",
      text: `Debt engagement ${r.reference || "?"} with ${r.lender || "?"} — status ${r.status}, principal ${r.principal_amount || 0} XAF, outstanding ${r.outstanding_balance || 0} XAF.`,
    }),
  },
  // ── HR ──
  {
    key: "hr_contract",
    sql: `SELECT hc.contract_id, hc.contract_type, hc.status, hc.start_date, hc.end_date, e.full_name AS employee_name
            FROM hr_contract hc LEFT JOIN employee e ON e.employee_id = hc.employee_id
           ORDER BY hc.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `contract:${r.employee_name}`,
      title: `Contract: ${r.employee_name}`,
      confidentiality: "confidential",
      text: `Employment contract for ${r.employee_name || "?"} — ${r.contract_type || "?"} contract, status ${r.status}${r.start_date ? `, from ${new Date(r.start_date).toLocaleDateString()}` : ""}${r.end_date ? ` to ${new Date(r.end_date).toLocaleDateString()}` : ""}.`,
    }),
  },
  {
    key: "training",
    sql: `SELECT t.training_id, t.title, t.status, t.start_date, t.end_date, t.budget
            FROM training t ORDER BY t.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `training:${r.title}`,
      title: `Training: ${r.title}`,
      confidentiality: "normal",
      text: `Training "${r.title}" — status ${r.status}${r.start_date ? `, ${new Date(r.start_date).toLocaleDateString()}` : ""}${r.end_date ? ` to ${new Date(r.end_date).toLocaleDateString()}` : ""}${r.budget ? `, budget ${r.budget} XAF` : ""}.`,
    }),
  },
  {
    key: "payroll",
    sql: `SELECT p.payroll_id, p.period, p.status, p.total_gross, p.total_net, p.employee_count
            FROM payroll p ORDER BY p.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `payroll:${r.period}`,
      title: `Payroll ${r.period}`,
      confidentiality: "confidential",
      text: `Payroll for ${r.period || "?"} — status ${r.status}, ${r.employee_count || 0} employees, gross ${r.total_gross || 0} XAF, net ${r.total_net || 0} XAF.`,
    }),
  },
  // ── Fleet ──
  {
    key: "driver",
    sql: `SELECT d.driver_id, d.full_name, d.license_number, d.status, d.license_expiry
            FROM driver d ORDER BY d.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `driver:${r.full_name}`,
      title: `Driver: ${r.full_name}`,
      confidentiality: "normal",
      text: `Driver ${r.full_name} — license ${r.license_number || "?"}, status ${r.status}${r.license_expiry ? `, license expires ${new Date(r.license_expiry).toLocaleDateString()}` : ""}.`,
    }),
  },
  {
    key: "fuel_log",
    sql: `SELECT fl.fuel_log_id, fl.quantity_litres, fl.cost, fl.log_date, v.plate
            FROM fuel_log fl LEFT JOIN vehicle v ON v.vehicle_id = fl.vehicle_id
           ORDER BY fl.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `fuel_log:${r.fuel_log_id}`,
      title: `Fuel Log: ${r.plate}`,
      confidentiality: "normal",
      text: `Fuel log for vehicle ${r.plate || "?"} — ${r.quantity_litres || 0} litres, cost ${r.cost || 0} XAF${r.log_date ? `, ${new Date(r.log_date).toLocaleDateString()}` : ""}.`,
    }),
  },
  {
    key: "work_order",
    sql: `SELECT wo.work_order_id, wo.doc_number, wo.status, wo.description, v.plate
            FROM work_order wo LEFT JOIN vehicle v ON v.vehicle_id = wo.vehicle_id
           ORDER BY wo.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `work_order:${r.doc_number || r.work_order_id}`,
      title: `Work Order ${r.doc_number || "draft"}`,
      confidentiality: "normal",
      text: `Work order ${r.doc_number || "draft"} for vehicle ${r.plate || "?"} — status ${r.status}, ${r.description || "no description"}.`,
    }),
  },
  // ── WMS ──
  {
    key: "inventory",
    sql: `SELECT i.inventory_id, i.name, i.sku, i.quantity_on_hand, i.unit_cost, w.name AS warehouse_name
            FROM inventory i LEFT JOIN warehouse_location w ON w.warehouse_location_id = i.warehouse_location_id
           ORDER BY i.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `inventory:${r.sku || r.name}`,
      title: `Stock: ${r.name}`,
      confidentiality: "normal",
      text: `Inventory item "${r.name}" (SKU ${r.sku || "?"}) at ${r.warehouse_name || "?"} — ${r.quantity_on_hand || 0} units on hand, unit cost ${r.unit_cost || 0} XAF.`,
    }),
  },
  {
    key: "warehouse_location",
    sql: `SELECT wl.warehouse_location_id, wl.name, wl.location_type, wl.capacity, wl.status
            FROM warehouse_location wl ORDER BY wl.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `warehouse:${r.name}`,
      title: `Warehouse: ${r.name}`,
      confidentiality: "normal",
      text: `Warehouse "${r.name}" — type ${r.location_type || "?"}, capacity ${r.capacity || "?"}, status ${r.status || "?"}.`,
    }),
  },
  // ── Sales ──
  {
    key: "proposal",
    sql: `SELECT p.proposal_id, p.doc_number, p.status, p.total_ttc, c.name AS client
            FROM proposal p LEFT JOIN client_master c ON c.client_id = p.client_id
           ORDER BY p.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `proposal:${r.doc_number || r.proposal_id}`,
      title: `Proposal ${r.doc_number || "draft"}`,
      confidentiality: "normal",
      text: `Proposal ${r.doc_number || "draft"} for ${r.client || "?"} — status ${r.status}, total ${r.total_ttc || 0} XAF.`,
    }),
  },
  {
    key: "marketing_campaign",
    sql: `SELECT mc.campaign_id, mc.name, mc.status, mc.budget, mc.start_date, mc.end_date
            FROM marketing_campaign mc ORDER BY mc.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `campaign:${r.name}`,
      title: `Campaign: ${r.name}`,
      confidentiality: "normal",
      text: `Marketing campaign "${r.name}" — status ${r.status}, budget ${r.budget || 0} XAF${r.start_date ? `, ${new Date(r.start_date).toLocaleDateString()}` : ""}${r.end_date ? ` to ${new Date(r.end_date).toLocaleDateString()}` : ""}.`,
    }),
  },
  // ── Master data ──
  {
    key: "chart_of_accounts",
    sql: `SELECT coa.account_id, coa.account_number, coa.account_name, coa.account_class, coa.is_active
            FROM chart_of_accounts coa WHERE coa.is_active = true ORDER BY coa.account_number LIMIT $1`,
    card: (r) => ({
      ref: `account:${r.account_number}`,
      title: `Account ${r.account_number}: ${r.account_name}`,
      confidentiality: "normal",
      text: `OHADA account ${r.account_number} "${r.account_name}" — class ${r.account_class || "?"}${r.is_active ? "" : " (inactive)"}.`,
    }),
  },
  {
    key: "treasury_account",
    sql: `SELECT ta.treasury_account_id, ta.name, ta.account_type, ta.currency, ta.status, ta.bank_name
            FROM treasury_account ta ORDER BY ta.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `treasury:${r.name}`,
      title: `Treasury: ${r.name}`,
      confidentiality: "confidential",
      text: `Treasury account "${r.name}" at ${r.bank_name || "?"} — type ${r.account_type || "?"}, currency ${r.currency || "XAF"}, status ${r.status || "?"}.`,
    }),
  },

  /* ── The tenant's OWN legal entities ─────────────────────────────────────
   *
   * Added last and it should have been first. Every counterparty had a card —
   * client_master, supplier_master, driver, employee — while the companies we
   * invoice AS had none, so the assistant had function-calling tools for
   * entities and no retrieval grounding whatsoever about them. Asked "what is
   * our share capital" it had nothing to recall and answered from the shape of
   * the question instead, describing the figure as derived and checked against
   * a legal minimum. Neither is true: it is a stored statutory fact, printed on
   * our own letterhead, and no minimum-capital rule exists anywhere in this
   * codebase.
   *
   * Normal confidentiality, deliberately: legal form, share capital, the
   * registered identifiers and the incorporation details are exactly what the
   * letterhead prints on every invoice we send. The governance data that IS
   * restricted — shareholdings, dates of birth, identity numbers — lives in
   * entity_person and is not carded here at all.
   */
  {
    key: "corporate_entity",
    sql: `SELECT e.code, e.legal_name, e.trading_name, e.legal_form, e.country_code,
                 e.registration_status, e.is_active, e.accounting_framework,
                 e.share_capital, e.share_capital_currency, e.share_capital_paid_up,
                 e.incorporation_date, e.incorporation_place, e.default_currency,
                 e.doc_prefix, e.industry, e.relationship_type,
                 p.code AS parent_code, p.legal_name AS parent_name
            FROM corporate_entity e
            LEFT JOIN corporate_entity p ON p.entity_id = e.parent_entity_id
           ORDER BY e.created_at DESC LIMIT $1`,
    card: (r) => {
      const name = [r.legal_name, r.legal_form].filter(Boolean).join(" ") || r.code || "?";
      const capital = r.share_capital === null || r.share_capital === undefined
        ? null
        : `share capital ${Number(r.share_capital).toLocaleString("en-US")} ${r.share_capital_currency || r.default_currency || "XAF"}`
          + (r.share_capital_paid_up !== null && r.share_capital_paid_up !== undefined
            && Number(r.share_capital_paid_up) !== Number(r.share_capital)
            ? ` (${Number(r.share_capital_paid_up).toLocaleString("en-US")} paid up)` : "");
      const born = r.incorporation_date
        ? `incorporated ${String(r.incorporation_date).slice(0, 10)}${r.incorporation_place ? ` in ${r.incorporation_place}` : ""}`
        : null;
      const group = r.parent_code
        ? `${(r.relationship_type || "subsidiary").toLowerCase().replace(/_/g, " ")} of ${r.parent_code} — ${r.parent_name}`
        : "top-level or standalone company";
      return {
        ref: `entity:${r.code || r.legal_name || "?"}`,
        title: `Our entity ${r.code || ""}: ${r.legal_name || "?"}`.replace("  ", " "),
        confidentiality: "normal",
        text: [
          `${name} (${r.code || "?"}) is one of OUR OWN legal entities — a company we invoice and report from, not a counterparty.`,
          r.trading_name ? `Trades as ${r.trading_name}.` : null,
          [born, capital].filter(Boolean).join(", ") ? `${[born, capital].filter(Boolean).join(", ")}.` : null,
          `Registered in ${r.country_code || "?"}, status ${r.registration_status || (r.is_active === false ? "DEACTIVATED" : "ACTIVE")}.`,
          r.accounting_framework ? `Reports under ${r.accounting_framework}.` : null,
          `Invoices in ${r.default_currency || "XAF"}${r.doc_prefix ? ` with document prefix ${r.doc_prefix}` : ""}.`,
          r.industry ? `Industry: ${r.industry}.` : null,
          `Group position: ${group}.`,
        ].filter(Boolean).join(" "),
      };
    },
  },

  /* Our own tax and trade identifiers, one card per registration — "what is our
   * NIU", "which VAT number do we invoice under in France". Its own builder
   * rather than a join on the card above, so `tableExists` skips it cleanly on a
   * tenant that predates 0515 instead of failing the whole reindex. */
  {
    key: "entity_registration",
    sql: `SELECT r.kind, r.number, r.country_code, r.issuing_authority, r.expires_on, r.is_primary,
                 e.code AS entity_code, e.legal_name
            FROM entity_registration r
            JOIN corporate_entity e ON e.entity_id = r.entity_id
           WHERE r.number IS NOT NULL
           ORDER BY r.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `entity-registration:${r.entity_code || "?"}-${r.kind || "?"}`,
      title: `Our ${r.kind || "registration"} (${r.entity_code || "?"})`,
      confidentiality: "normal",
      text: `${r.legal_name || r.entity_code || "?"} holds ${r.kind || "a registration"} ${r.number || "?"}`
        + `${r.country_code ? ` in ${r.country_code}` : ""}`
        + `${r.issuing_authority ? `, issued by ${r.issuing_authority}` : ""}`
        + `${r.is_primary ? " (primary for that country)" : ""}`
        + `${r.expires_on ? `, expiring ${String(r.expires_on).slice(0, 10)}` : ""}.`,
    }),
  },
];

async function tableExists(client, name) {
  const { rows } = await client.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1",
    [name],
  );
  return rows.length > 0;
}

async function buildEntityCards(client, opts = {}) {
  const limit = opts.limitPerEntity || 500;
  const cards = [];
  for (const b of BUILDERS) {
    if (!(await tableExists(client, b.key))) continue;
    const { rows } = await client.query(b.sql, [limit]);
    for (const r of rows) cards.push(b.card(r));
  }
  return cards;
}

module.exports = { buildEntityCards, BUILDERS };

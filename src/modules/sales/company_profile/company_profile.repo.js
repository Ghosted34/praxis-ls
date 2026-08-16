"use strict";

const JSONB_COLUMNS = new Set([
  "service_promises",
  "fleet_composition",
  "top_lanes",
  "vertical_mix",
]);

const get = async (c) => (await c.query("SELECT * FROM company_profile WHERE singleton = true")).rows[0] || null;

async function update(c, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return get(c);
  const vals = keys.map((k) => {
    const val = fields[k];
    if (JSONB_COLUMNS.has(k) && val !== null && val !== undefined) {
      return typeof val === "string" ? val : JSON.stringify(val);
    }
    return val;
  });
  const set = keys.map((k, i) => `"${k}"=$${i + 1}`).join(",");
  const res = await c.query(`UPDATE company_profile SET ${set}, updated_at=now() WHERE singleton=true RETURNING *`, vals);
  if (!res.rows[0]) {
    await c.query("INSERT INTO company_profile (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING");
    return (await c.query(`UPDATE company_profile SET ${set}, updated_at=now() WHERE singleton=true RETURNING *`, vals)).rows[0];
  }
  return res.rows[0];
}

const projects = async (c, id) => (await c.query("SELECT * FROM company_profile_project WHERE company_profile_id=$1 ORDER BY sort_order", [id])).rows;

async function replaceProjects(c, id, rows) {
  await c.query("DELETE FROM company_profile_project WHERE company_profile_id=$1", [id]);
  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    const metrics = p.metrics ? (typeof p.metrics === "string" ? p.metrics : JSON.stringify(p.metrics)) : "{}";
    await c.query(
      "INSERT INTO company_profile_project(company_profile_id,name_en,name_fr,description_en,description_fr,metrics,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [id, p.name_en, p.name_fr || null, p.description_en || null, p.description_fr || null, metrics, p.sort_order ?? i],
    );
  }
}

async function derived(c) {
  const q = `SELECT
  (SELECT count(*)::int FROM vehicle WHERE status='ACTIVE') fleet_count,
  (SELECT COALESCE(jsonb_object_agg(category,n),'{}') FROM (SELECT COALESCE(category,'Unspecified') category,count(*) n FROM vehicle WHERE status='ACTIVE' GROUP BY category)v) fleet_composition,
  (SELECT COALESCE(sum(capacity_units),0) FROM warehouse_location) warehouse_capacity,
  (SELECT COALESCE(jsonb_agg(x),'[]') FROM (SELECT pol origin,pod destination,count(*) frequency FROM dossier_visible WHERE pol IS NOT NULL AND pod IS NOT NULL GROUP BY pol,pod ORDER BY frequency DESC LIMIT 10)x) top_lanes,
  (SELECT COALESCE(jsonb_agg(x),'[]') FROM (SELECT COALESCE(st.name_en,st.name_fr) service,count(*) frequency FROM dossier_visible d JOIN service_type st ON st.service_type_id=d.service_type_id GROUP BY COALESCE(st.name_en,st.name_fr) ORDER BY frequency DESC)x) vertical_mix,
  (SELECT round(avg(extract(epoch FROM (done.completed_at-started.created_at))/3600)::numeric,2) FROM milestone_instance done JOIN dossier_visible d USING(dossier_id) JOIN LATERAL (SELECT created_at FROM milestone_instance mi WHERE mi.dossier_id=d.dossier_id ORDER BY stage_seq LIMIT 1) started ON true WHERE done.status='DONE' AND done.code ILIKE '%clear%') average_clearance_hours,
  (SELECT count(*)::int FROM client_master WHERE is_active) client_count,
  (SELECT CASE WHEN COALESCE(sum(jl.credit),0)<100000000 THEN '<100M XAF' WHEN sum(jl.credit)<500000000 THEN '100M–500M XAF' WHEN sum(jl.credit)<1000000000 THEN '500M–1B XAF' ELSE '1B+ XAF' END FROM journal_line jl JOIN journal_entry je USING(entry_id) WHERE je.status='validated' AND jl.account_code LIKE '7%') turnover_band`;
  return (await c.query(q)).rows[0];
}

module.exports = { get, update, projects, replaceProjects, derived };

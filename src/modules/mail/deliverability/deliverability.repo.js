"use strict";

const insertCheck = (client, row) =>
  client.query(
    `INSERT INTO domain_health_check (domain, record, selector, verdict, value, suggestion, checked_at)
     VALUES ($1,$2,$3,$4,$5,$6, now()) RETURNING *`,
    [row.domain, row.record, row.selector || null, row.verdict, row.value || null, row.suggestion || null],
  ).then((r) => r.rows[0]);

const latestByDomain = (client) =>
  client.query(
    `SELECT DISTINCT ON (domain, record) *
       FROM domain_health_check
      ORDER BY domain, record, checked_at DESC`,
  ).then((r) => r.rows);

const history = (client, domain, { limit = 50 } = {}) =>
  client.query(
    `SELECT * FROM domain_health_check WHERE domain = $1
      ORDER BY checked_at DESC LIMIT $2`,
    [domain, Math.min(Number(limit) || 50, 200)],
  ).then((r) => r.rows);

const previous = (client, domain, record) =>
  client.query(
    `SELECT * FROM domain_health_check
      WHERE domain = $1 AND record = $2
      ORDER BY checked_at DESC LIMIT 1`,
    [domain, record],
  ).then((r) => r.rows[0] || null);

async function sendingDomains(client) {
  const { rows } = await client.query(
    `SELECT DISTINCT lower(split_part(from_address, '@', 2)) AS domain
       FROM email_identity
      WHERE from_address LIKE '%@%'
     UNION
     SELECT DISTINCT lower(split_part(email_address, '@', 2))
       FROM email_connection
      WHERE email_address LIKE '%@%' AND status <> 'ARCHIVED'`,
  );
  return rows.map((r) => r.domain).filter(Boolean);
}

const sendingIp = async (client) => {
  const { rows } = await client.query(
    `SELECT smtp_host FROM email_identity WHERE smtp_host IS NOT NULL LIMIT 1`,
  );
  return (rows[0] && rows[0].smtp_host) || null;
};

module.exports = { insertCheck, latestByDomain, history, previous, sendingDomains, sendingIp };

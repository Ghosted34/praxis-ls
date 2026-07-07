/* api.js - shared fetch helpers */

async function apiGet(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  const text = await res.text();

  let json;
  try { json = JSON.parse(text); }
  catch {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 200)}`);
  }

  if (!res.ok || json.ok === false) {
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  return json;
}

async function apiPost(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload || {})
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 200)}`);
  }

  if (!res.ok || json.ok === false) {
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  return json;
}

// Basic debounce utility (used for autocomplete)
function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Browser helper for the employee /api/crm/* routes. Identity comes from the
// signed employeeSession cookie; this helper only adds the CSRF header.
export class CrmApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body || {};
  }
}

export async function crmFetch(path, { method = 'GET', body, query, keepalive } = {}) {
  let url = path;
  if (query) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    });
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    keepalive,
    headers: { 'x-crm-request': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) throw new CrmApiError(data.error || `Request failed (${res.status})`, res.status, data);
  return data;
}

// netlify/functions/qb-refresh.js
const { getStore } = require('@netlify/blobs');
exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };
  const clientId = process.env.QB_CLIENT_ID;
  const clientSecret = process.env.QB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { statusCode: 500, headers, body: JSON.stringify({ error: 'QB credentials not configured' }) };
  try {
    const { realmId } = JSON.parse(event.body || '{}');
    if (!realmId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'realmId required' }) };
    const store = getStore({ name: 'qb-tokens', consistency: 'strong', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN });
    const stored = await store.get(`realm-${realmId}`, { type: 'json' });
    if (!stored || !stored.refreshToken) return { statusCode: 401, headers, body: JSON.stringify({ error: 'no_refresh_token', message: 'No saved session. Please reconnect QuickBooks.' }) };
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: stored.refreshToken }).toString()
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok || !tokens.access_token) {
      const msg = tokens.error_description || tokens.error || 'Refresh failed';
      if (tokens.error === 'invalid_grant') await store.delete(`realm-${realmId}`);
      return { statusCode: 401, headers, body: JSON.stringify({ error: msg, needsReconnect: true }) };
    }
    if (tokens.refresh_token) await store.setJSON(`realm-${realmId}`, { refreshToken: tokens.refresh_token, realmId, savedAt: Date.now() });
    return { statusCode: 200, headers, body: JSON.stringify({ access_token: tokens.access_token, expires_in: tokens.expires_in || 3600, expires_at: Date.now() + (tokens.expires_in || 3600) * 1000 }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

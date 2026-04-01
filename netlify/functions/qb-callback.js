// netlify/functions/qb-callback.js
const { getStore } = require('@netlify/blobs');
exports.handler = async (event) => {
  const { code, realmId, error } = event.queryStringParameters || {};
  const siteUrl = process.env.URL || 'http://localhost:8888';
  if (error) return { statusCode: 302, headers: { Location: `${siteUrl}/#qb_error=${encodeURIComponent(error)}` } };
  if (!code || !realmId) return { statusCode: 302, headers: { Location: `${siteUrl}/#qb_error=missing_code` } };
  const clientId = process.env.QB_CLIENT_ID;
  const clientSecret = process.env.QB_CLIENT_SECRET;
  const redirectUri = process.env.QB_REDIRECT_URI;
  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }).toString()
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok || !tokens.access_token) {
      const msg = tokens.error_description || tokens.error || 'Token exchange failed';
      return { statusCode: 302, headers: { Location: `${siteUrl}/#qb_error=${encodeURIComponent(msg)}` } };
    }
    if (tokens.refresh_token) {
      try {
        const store = getStore({ name: 'qb-tokens', consistency: 'strong', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN });
        await store.setJSON(`realm-${realmId}`, { refreshToken: tokens.refresh_token, realmId, savedAt: Date.now() });
      } catch (blobErr) { console.error('Blob store error (non-fatal):', blobErr.message); }
    }
    const fragment = new URLSearchParams({ qb_token: tokens.access_token, qb_realm: realmId, qb_expires: String(Date.now() + (tokens.expires_in || 3600) * 1000) }).toString();
    return { statusCode: 302, headers: { Location: `${siteUrl}/#${fragment}` } };
  } catch (err) {
    return { statusCode: 302, headers: { Location: `${siteUrl}/#qb_error=${encodeURIComponent(err.message)}` } };
  }
};

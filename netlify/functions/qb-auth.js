// netlify/functions/qb-auth.js
exports.handler = async (event) => {
  const clientId = process.env.QB_CLIENT_ID;
  const redirectUri = process.env.QB_REDIRECT_URI;
  if (!clientId || !redirectUri) return { statusCode: 500, body: JSON.stringify({ error: 'QuickBooks not configured. Set QB_CLIENT_ID and QB_REDIRECT_URI in Netlify environment variables.' }) };
  const scope = 'com.intuit.quickbooks.accounting';
  const state = Buffer.from(JSON.stringify({ ts: Date.now() })).toString('base64');
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope, state });
  return { statusCode: 302, headers: { Location: `https://appcenter.intuit.com/connect/oauth2?${params.toString()}` } };
};

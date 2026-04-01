// netlify/functions/analyze.js
exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set. Go to Netlify → Site Settings → Environment Variables and add it, then redeploy.' }) };
  try {
    const body = JSON.parse(event.body);
    const hasPDF = (body.messages || []).some(m => Array.isArray(m.content) && m.content.some(c => c.type === 'document'));
    const reqHeaders = { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
    if (hasPDF) reqHeaders['anthropic-beta'] = 'pdfs-2024-09-25';
    const payload = { model: 'claude-sonnet-4-20250514', max_tokens: body.max_tokens || 4000, messages: body.messages };
    if (body.system) payload.system = body.system;
    const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: reqHeaders, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) return { statusCode: response.status, headers, body: JSON.stringify({ error: data.error?.message || 'Anthropic API error', details: data }) };
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

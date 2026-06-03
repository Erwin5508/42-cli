'use strict';

const https = require('https');
const os = require('os');
const localPkg = require('../../package.json');

// Where feedback is delivered. We use a form→email service (Formspree) so the
// CLI can send a real email to the maintainer without shipping SMTP secrets:
// the destination address is configured on the service side, the endpoint id
// below is not a secret. Override at runtime with FEEDBACK_ENDPOINT.
//
// To go live: create a free form at https://formspree.io pointing to
// bruno.gomez@learner.42.tech and replace the id below with your form id.
const DEFAULT_ENDPOINT = 'https://formspree.io/f/xpqeagag';
const FETCH_TIMEOUT_MS = 8000;

function endpoint() {
  return (process.env.FEEDBACK_ENDPOINT || DEFAULT_ENDPOINT).trim();
}

function isConfigured() {
  const e = endpoint();
  return !!e && !e.includes('REPLACE_WITH') && /^https:\/\//.test(e);
}

function postJson(url, payload, timeoutMs) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return resolve({ ok: false, error: 'invalid endpoint URL' });
    }
    const data = JSON.stringify(payload);
    const opts = {
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname + u.search,
      port: u.port || 443,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': '42-cli',
      },
    };
    let body = '';
    const req = https.request(opts, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        resolve({ ok, status: res.statusCode, body });
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ ok: false, error: 'request timed out' });
    });
    req.write(data);
    req.end();
  });
}

// Build the payload sent to the maintainer. `email` is optional (reply-to) and
// the field is named `email` so Formspree threads replies back to the user.
function buildPayload({ name, login, email, category, message }) {
  const payload = {
    _subject: `[42-cli feedback] ${category || 'general'} — ${name || 'anonymous'}`,
    name: name || 'anonymous',
    login: login || '',
    category: category || 'general',
    message: message || '',
    version: localPkg.version,
    platform: `${os.platform()} ${os.release()}`,
    node: process.version,
  };
  if (email) {
    payload.email = email;
    payload._replyto = email;
  }
  return payload;
}

async function send(fields) {
  if (!isConfigured()) {
    return { ok: false, error: 'unconfigured', unconfigured: true };
  }
  const payload = buildPayload(fields);
  const res = await postJson(endpoint(), payload, FETCH_TIMEOUT_MS);
  return res;
}

module.exports = { send, buildPayload, isConfigured, endpoint, DEFAULT_ENDPOINT };

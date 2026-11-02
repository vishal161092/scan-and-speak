// Server-side Salesforce helper. Holds credentials, mints an access token via
// the OAuth 2.0 Client Credentials flow, and exposes helpers to read a record's
// Customer 360 and to call the nudge Apex REST endpoint. The browser never sees
// a token — everything here runs in Next.js API routes (serverless functions).

import { LEAD_TIMELINE, HUMAN_CALLS } from './mock';

let cachedToken = null; // { access_token, instance_url, expiresAt }

export function sfConfigured() {
  return Boolean(
    process.env.SF_LOGIN_URL &&
      process.env.SF_CLIENT_ID &&
      process.env.SF_CLIENT_SECRET &&
      String(process.env.USE_MOCK).toLowerCase() !== 'true'
  );
}

const API_VERSION = () => process.env.SF_API_VERSION || '61.0';

async function getToken(force = false) {
  const now = Date.now();
  if (!force && cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken;

  const url = `${process.env.SF_LOGIN_URL.replace(/\/$/, '')}/services/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.SF_CLIENT_ID,
    client_secret: process.env.SF_CLIENT_SECRET,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Salesforce token request failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  // Honour the token's own lifetime when returned; otherwise assume a short,
  // conservative window. A stale module-cached token in a warm serverless
  // instance is recovered by the 401-retry in sfFetch regardless.
  const ttlMs = json.expires_in ? Number(json.expires_in) * 1000 : 15 * 60_000;
  cachedToken = {
    access_token: json.access_token,
    instance_url: json.instance_url || process.env.SF_LOGIN_URL,
    expiresAt: now + ttlMs,
  };
  return cachedToken;
}

async function sfFetch(path, init = {}, _retried = false) {
  const token = await getToken();
  const url = `${token.instance_url.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    // A stale/expired session id surfaces as 401 (INVALID_SESSION_ID /
    // INVALID_AUTH_HEADER). Drop the cached token, mint a fresh one, retry once.
    if (res.status === 401 && !_retried) {
      cachedToken = null;
      await getToken(true);
      return sfFetch(path, init, true);
    }
    const text = await res.text();
    throw new Error(`Salesforce API ${path} failed (${res.status}): ${text}`);
  }
  // 204 No Content (e.g. a successful PATCH) has an empty body.
  if (res.status === 204) return {};
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function query(soql) {
  const path = `/services/data/v${API_VERSION()}/query/?q=${encodeURIComponent(soql)}`;
  const json = await sfFetch(path);
  return json.records || [];
}

// Determine the SObject type of a record id from its 3-char key prefix.
async function describeType(recordId) {
  // Common prefixes; fall back to Contact.
  const prefix = recordId.substring(0, 3);
  if (prefix === '001') return 'Account';
  if (prefix === '003') return 'Contact';
  if (prefix === '00Q') return 'Lead';
  return 'Contact';
}

// Best-effort Customer 360. Reads the base record plus related Cases, Assets
// (vehicles), and Service Appointments. Field names are kept generic so this
// works on a stock org; adjust the SOQL to your data model as needed.
export async function getCustomer360(recordId) {
  const type = await describeType(recordId);

  if (type === 'Lead') return getLead360(recordId);

  const isAccount = type === 'Account';

  const base = await sfFetch(
    `/services/data/v${API_VERSION()}/sobjects/${type}/${recordId}`
  );

  const name = base.Name || `${base.FirstName || ''} ${base.LastName || ''}`.trim();
  const contactFilter = isAccount ? `AccountId = '${recordId}'` : `ContactId = '${recordId}'`;

  const [cases, assets] = await Promise.all([
    query(
      `SELECT Id, CaseNumber, Subject, Status, Priority, CreatedDate FROM Case WHERE ${contactFilter} ORDER BY CreatedDate DESC LIMIT 10`
    ).catch(() => []),
    query(
      `SELECT Id, Name, Status, SerialNumber, InstallDate FROM Asset WHERE ${
        isAccount ? `AccountId = '${recordId}'` : `ContactId = '${recordId}'`
      } ORDER BY InstallDate DESC LIMIT 10`
    ).catch(() => []),
  ]);

  const fields = [];
  const push = (label, value) => value && fields.push({ label, value });
  push('Phone', base.Phone || base.MobilePhone);
  push('Email', base.Email || base.PersonEmail);
  push('City', base.MailingCity || base.BillingCity);
  push('Account', base.AccountName);

  return {
    id: recordId,
    scannedId: recordId,
    recordType: type,
    name: name || 'Customer',
    photoUrl: base.PhotoUrl || '',
    headline: base.Description || '',
    fields,
    vehicles: assets.map((a) => ({
      id: a.Id,
      name: a.Name,
      subtitle: [a.SerialNumber, a.InstallDate].filter(Boolean).join(' • '),
      status: a.Status || '',
      meta: '',
    })),
    cases: cases.map((c) => ({
      id: c.Id,
      subject: c.Subject || '(no subject)',
      status: c.Status || '',
      priority: c.Priority || '',
      meta: `Case #${c.CaseNumber || ''}`,
    })),
    appointments: [],
    serviceHistory: [],
  };
}

// Lead qualification scoring — mirrors the desktop de_veloLeadScore /
// contact-card logic so the phone shows the same number and drivers.
const TIME_PTS = { 'Immediate (0-15 days)': 25, 'Within 1 Month': 20, '1-3 Months': 15, '3-6 Months': 8, 'Just Exploring': 3 };
const TD_PTS = { Completed: 30, Scheduled: 22, 'Follow-up Needed': 12, 'Not Scheduled': 4 };
const PIPELINE = ['New', 'Working', 'Qualified', 'Converted'];

function pipelineIndex(status, isConverted) {
  if (isConverted) return 3;
  const s = (status || '').toLowerCase();
  if (s.includes('qualified')) return 2;
  if (s.includes('convert')) return 3;
  if (s.includes('working') || s.includes('contacted') || s.includes('nurtur')) return 1;
  return 0;
}

function daysSince(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
}

function fmtDuration(sec) {
  if (sec == null || sec === '') return '';
  const s = Number(sec);
  if (Number.isNaN(s)) return '';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Sentiment score → label + a pill kind that reuses existing styled pills.
// Handles both -1..1 and 0..100 score scales.
function sentimentFrom(score) {
  if (score == null || score === '') return null;
  const n = Number(score);
  if (Number.isNaN(n)) return null;
  const norm = Math.abs(n) <= 1 ? n : (n - 50) / 50;
  if (norm >= 0.2) return { label: 'Positive', kind: 'ok' };
  if (norm <= -0.2) return { label: 'Negative', kind: 'high' };
  return { label: 'Neutral', kind: 'medium' };
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Maps a de_AI_Call__c mirror row to the AI-call card shape. Fields the org
// hasn't populated (summary, sentiment, reason) are left null so the card omits
// them.
function mapVoiceCall(vc) {
  const sentiment = sentimentFrom(vc.de_Customer_Sentiment__c ?? vc.de_Agent_Sentiment__c);
  return {
    id: vc.Id,
    title: vc.de_Reason__c || 'Outbound Call',
    ref: vc.Name || '',
    direction: vc.de_Call_Type__c || '',
    duration: fmtDuration(vc.de_Duration_Seconds__c),
    date: fmtDateTime(vc.de_Call_Start__c),
    sentiment: sentiment?.label || null,
    sentimentKind: sentiment?.kind || null,
    disposition: vc.de_Disposition__c ? cap(vc.de_Disposition__c) : null,
    recorded: Boolean(vc.de_Is_Recorded__c),
    summary: vc.de_Description__c || null,
  };
}

// AI calling history — VoiceCall is a feature-gated Service Cloud Voice object
// the client-credentials token can't query (it returns INVALID_AUTH_HEADER). The
// de_VoiceCallMirrorTrigger keeps de_AI_Call__c in sync with VoiceCall, and that
// custom object IS reachable via the standard Data API.
async function getVoiceCalls(recordId) {
  const soql =
    `SELECT Id, Name, de_Call_Type__c, de_Call_Start__c, de_Duration_Seconds__c, ` +
    `de_Is_Recorded__c, de_Disposition__c, de_Reason__c, de_Agent_Sentiment__c, ` +
    `de_Customer_Sentiment__c, de_Description__c ` +
    `FROM de_AI_Call__c WHERE de_Lead__c = '${recordId}' ` +
    `ORDER BY de_Call_Start__c DESC NULLS LAST LIMIT 20`;
  const rows = await query(soql);
  return rows.map(mapVoiceCall);
}

// Lead 360 — a sales prospect (00Q...). Surfaces the same content as the desktop
// Lead record page: status pipeline, qualification score, vehicle interest,
// qualification detail, contact + consent, and the demo timeline / call history.
async function getLead360(recordId) {
  const base = await sfFetch(
    `/services/data/v${API_VERSION()}/sobjects/Lead/${recordId}`
  );

  const name = base.Name || `${base.FirstName || ''} ${base.LastName || ''}`.trim();

  let _voiceErr = null;
  const [activities, ownerRows, aiCalls] = await Promise.all([
    query(
      `SELECT Id, Subject, Status, ActivityDate FROM Task WHERE WhoId = '${recordId}' ORDER BY CreatedDate DESC LIMIT 10`
    ).catch(() => []),
    query(`SELECT Owner.Name FROM Lead WHERE Id = '${recordId}' LIMIT 1`).catch(() => []),
    getVoiceCalls(recordId).catch((e) => { _voiceErr = String(e.message || e).slice(-200); return []; }),
  ]);
  const ownerName = ownerRows[0]?.Owner?.Name || '';

  // ---- contact fields (kept lean; status/rating/source live in their own sections) ----
  const fields = [];
  const push = (label, value) => value && fields.push({ label, value });
  push('Phone', base.MobilePhone || base.Phone);
  push('Email', base.Email);
  push('City', [base.City, base.State].filter(Boolean).join(', '));
  push('Company', base.Company);
  push('Lead Owner', ownerName);

  // ---- status pipeline ----
  const idx = pipelineIndex(base.Status, base.IsConverted);
  const age = daysSince(base.CreatedDate);
  const status = {
    current: base.IsConverted ? 'Converted' : base.Status || 'New',
    percent: Math.round(((idx + 1) / PIPELINE.length) * 100),
    ageLabel: age === null ? '' : age === 0 ? 'Added today' : `${age}d in pipeline`,
    lastActivity: base.LastActivityDate ? fmtDate(base.LastActivityDate) : 'No activity',
    steps: PIPELINE.map((label, i) => ({
      label,
      state: i < idx ? 'done' : i === idx ? 'current' : 'todo',
    })),
  };

  // ---- qualification score (explicit field, else computed) ----
  const modelPts = base.Model_Interest__c ? 25 : 0;
  const budgetPts = base.Budget_Range__c ? 20 : 0;
  const urgencyPts = TIME_PTS[base.Purchase_Timeframe__c] || 0;
  const tdPts = TD_PTS[base.Test_Drive_Status__c] || 0;
  const computed = modelPts + budgetPts + urgencyPts + tdPts;
  const scoreVal =
    base.Engagement_Score__c != null && base.Engagement_Score__c !== ''
      ? Math.round(Number(base.Engagement_Score__c))
      : computed;
  const band = scoreVal >= 70 ? 'Hot' : scoreVal >= 40 ? 'Warm' : 'Cold';
  const score = {
    value: scoreVal,
    band,
    bandKind: band === 'Hot' ? 'high' : band === 'Warm' ? 'medium' : 'low',
    drivers: [
      { label: 'Model Interest', pts: modelPts, max: 25 },
      { label: 'Budget Provided', pts: budgetPts, max: 20 },
      { label: 'Purchase Urgency', pts: urgencyPts, max: 25 },
      { label: 'Test Drive', pts: tdPts, max: 30 },
    ],
  };

  // ---- vehicle interest ----
  const tdStatus = base.Test_Drive_Status__c || 'Not Scheduled';
  const tdKind =
    tdStatus === 'Completed' ? 'ok' : tdStatus === 'Scheduled' ? 'high' : tdStatus === 'Follow-up Needed' ? 'medium' : 'low';
  const subParts = [base.Variant__c, base.Fuel_Preference__c, base.Transmission_Preference__c].filter(Boolean);
  const vehicleInterest = {
    model: base.Model_Interest__c || 'Not captured',
    sub: subParts.length ? subParts.join(' · ') : 'Awaiting discovery',
    testDrive: tdStatus,
    testDriveKind: tdKind,
  };

  // ---- qualification detail tiles ----
  const qualification = [
    { label: 'Budget Range', value: base.Budget_Range__c || '—' },
    { label: 'Purchase Timeframe', value: base.Purchase_Timeframe__c || '—' },
    { label: 'Financing', value: base.Financing_Interest__c || '—' },
    { label: 'Trade-In', value: base.Trade_In_Vehicle__c || '—' },
    { label: 'Preferred Dealership', value: base.Preferred_Dealership__c || '—' },
    { label: 'Lead Source', value: base.LeadSource || '—' },
  ];

  const tags = [base.Rating, base.LeadSource, base.Test_Drive_Status__c].filter(Boolean);
  const consent = [];
  if (base.DoNotCall) consent.push('Do Not Call');
  if (base.HasOptedOutOfEmail) consent.push('Email Opt-Out');

  const headlineBits = ['Lead', base.Rating, base.Status].filter(Boolean);

  return {
    id: recordId,
    scannedId: recordId,
    recordType: 'Lead',
    name: name || 'Lead',
    photoUrl: '',
    headline: base.Description || headlineBits.join(' • '),
    fields,
    status,
    score,
    vehicleInterest,
    qualification,
    tags,
    consent,
    vehicles: [],
    cases: [],
    appointments: activities.map((t) => ({
      id: t.Id,
      name: t.Subject || 'Activity',
      subtitle: t.ActivityDate ? `Due ${t.ActivityDate}` : '',
      status: t.Status || '',
      meta: '',
    })),
    serviceHistory: [],
    // Real AI calling history (VoiceCall rows for this Lead); timeline + human
    // calls stay as demo content until wired to their own live sources.
    timeline: LEAD_TIMELINE,
    aiCalls,
    humanCalls: HUMAN_CALLS,
    _voiceErr,
  };
}

// ---- Showroom Copilot: live coaching nudges from the Flex prompt template ----
// Calls the "Showroom_Nudge_Flex" GenAiPromptTemplate every ~10s with the latest
// transcript + rolling context and returns its parsed JSON. The prompt is owned
// by the org and MUST NOT be modified here — we only feed inputs and read output.
const SHOWROOM_PROMPT = 'Showroom_Nudge_Flex';

function extractGeneration(json) {
  // Connect API returns the model output as generations[0].text; be defensive
  // about older/alternate shapes too.
  return (
    json?.generations?.[0]?.text ??
    json?.generation?.generatedText ??
    json?.generationDetails?.generations?.[0]?.text ??
    json?.response ??
    ''
  );
}

// Returns { phase, topic, longNudge, shortNudge, isNew, confidence, rollingSummary }.
export async function getShowroomNudge({
  latestTranscript,
  rollingSummary = '',
  currentPhase = '',
  lastNudgeText = '',
}) {
  const path = `/services/data/v${API_VERSION()}/einstein/prompt-templates/${SHOWROOM_PROMPT}/generations`;
  const payload = {
    isPreview: false,
    inputParams: {
      valueMap: {
        'Input:latestTranscript': { value: latestTranscript || '' },
        'Input:rollingSummary': { value: rollingSummary || '' },
        'Input:currentPhase': { value: currentPhase || '' },
        'Input:lastNudgeText': { value: lastNudgeText || '' },
      },
    },
    additionalConfig: {
      numGenerations: 1,
      applicationName: 'PromptTemplateGenerationsInvocable',
    },
  };

  const json = await sfFetch(path, { method: 'POST', body: JSON.stringify(payload) });
  let text = String(extractGeneration(json) || '').trim();
  // Strip accidental code fences the model may add despite instructions.
  text = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  if (!text) throw new Error('Empty generation from prompt template');
  const parsed = JSON.parse(text);
  parsed.responseId = json?.generations?.[0]?.responseId || json?.requestId || '';
  return parsed;
}

// ---- Personalized Pitch: pre-visit talk track from the lead record ----
// Runs the "Personalized_Pitch_Suggestion" prompt template — a single record
// input, the Lead ("LeadRec") — and returns its structured JSON pitch. The
// template is owned by the org and MUST NOT be modified here.
const PITCH_PROMPT = 'Personalized_Pitch_Suggestion';

// Prompt templates sometimes wrap the JSON in a code fence or add stray prose;
// strip fences, then fall back to the outermost { … } span before parsing.
function parseJsonLoose(raw) {
  let t = String(raw || '').trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(t.slice(s, e + 1));
      } catch {
        /* fall through */
      }
    }
  }
  return null;
}

// Returns the parsed pitch object: { customerName, vehicleInterest, leadContext,
// openingPitch, discoveryQuestions[], personalizedValuePitch, testDriveFocus[],
// closingPitch, tone }.
export async function getPersonalizedPitch(recordId) {
  const path = `/services/data/v${API_VERSION()}/einstein/prompt-templates/${PITCH_PROMPT}/generations`;
  const payload = {
    isPreview: false,
    inputParams: {
      // Record-type input — the Lead — is passed as { value: { id } }.
      valueMap: {
        'Input:LeadRec': { value: { id: recordId } },
      },
    },
    additionalConfig: {
      numGenerations: 1,
      applicationName: 'PromptTemplateGenerationsInvocable',
    },
  };

  const json = await sfFetch(path, { method: 'POST', body: JSON.stringify(payload) });
  const parsed = parseJsonLoose(extractGeneration(json));
  if (!parsed) throw new Error('Could not parse pitch generation');
  return parsed;
}

// ---- Sales Pitch Coach: post-conversation coaching from the full transcript ----
// Runs the "Sales_Pitch_Coach" prompt template — a single text input
// ("inputString") that carries the WHOLE conversation from start to finish — and
// returns its structured JSON review. Template is owned by the org; do NOT modify.
const COACH_PROMPT = 'Sales_Pitch_Coach';

// The prompt returns spaced UPPERCASE keys and bullet-prefixed list items. Fold
// them into a stable, camelCase shape the UI can render (and strip the leading
// bullet glyphs so the component draws its own list markers).
function normalizeCoach(p) {
  const pick = (...keys) => {
    for (const k of keys) if (p[k] != null && p[k] !== '') return p[k];
    return undefined;
  };
  const toList = (v) =>
    (Array.isArray(v) ? v : v ? [v] : [])
      .map((s) => String(s).replace(/^\s*[•\-*]\s*/, '').trim())
      .filter(Boolean);
  return {
    summary: String(pick('SUMMARY OF THE PITCH', 'summary', 'Summary') || '').trim(),
    good: toList(pick('WHERE YOU DID GOOD', 'good', 'strengths')),
    improve: toList(pick('WHERE YOU CAN IMPROVE', 'improve', 'improvements')),
    improvedPitch: String(pick('IMPROVED PITCH TO PRACTICE', 'improvedPitch') || '')
      .replace(/^\s*"+|"+\s*$/g, '')
      .trim(),
  };
}

// Returns { summary, good[], improve[], improvedPitch }.
export async function getSalesPitchCoach(transcript) {
  const path = `/services/data/v${API_VERSION()}/einstein/prompt-templates/${COACH_PROMPT}/generations`;
  const payload = {
    isPreview: false,
    inputParams: {
      // Single text input — the whole conversation transcript.
      valueMap: {
        'Input:inputString': { value: transcript || '' },
      },
    },
    additionalConfig: {
      numGenerations: 1,
      applicationName: 'PromptTemplateGenerationsInvocable',
    },
  };

  const json = await sfFetch(path, { method: 'POST', body: JSON.stringify(payload) });
  const parsed = parseJsonLoose(extractGeneration(json));
  if (!parsed) throw new Error('Could not parse coach generation');
  return normalizeCoach(parsed);
}

// The single Nudge__c record we keep in sync with the latest coaching nudge.
// Set SF_NUDGE_RECORD_ID to the Id of a Nudge__c record in your org. When it is
// empty, the sync is skipped.
const NUDGE_RECORD_ID = () => process.env.SF_NUDGE_RECORD_ID || '';

// Fixed demo session identifier — always "Demo-001" (env-overridable).
const NUDGE_SESSION_ID = () => process.env.SF_NUDGE_SESSION_ID || 'Demo-001';

// PATCHes the Nudge__c record with the latest prompt output. Best-effort — the
// caller decides whether a failure here should surface. `nowIso` is passed in so
// the value is stamped by the request handler, not this helper.
export async function updateNudgeRecord({ nudge, nowIso, transcriptChunk = '' }) {
  if (!NUDGE_RECORD_ID()) return;
  const path = `/services/data/v${API_VERSION()}/sobjects/Nudge__c/${NUDGE_RECORD_ID()}`;
  const fields = {
    Long_Nudge__c: (nudge.longNudge || '').slice(0, 1000),
    Text__c: (nudge.shortNudge || '').slice(0, 1000),
    Category__c: (nudge.topic || '').slice(0, 50),
    Phase__c: (nudge.phase || '').slice(0, 40),
    Rolling_Summary__c: (nudge.rollingSummary || '').slice(0, 2000),
    Transcript_Chunk__c: (transcriptChunk || '').slice(0, 2000),
    Nudge_Id__c: (nudge.responseId || '').slice(0, 60),
    Session_Id__c: NUDGE_SESSION_ID().slice(0, 50),
    Last_Updated__c: nowIso,
  };
  // PATCH returns 204 No Content on success; sfFetch tolerates an empty body.
  await sfFetch(path, { method: 'PATCH', body: JSON.stringify(fields) });
}

// Calls the Apex REST endpoint that runs the Prompt Template and returns nudges.
export async function getNudgesFromSalesforce(recordId, transcriptChunk, fullTranscript) {
  const token = await getToken();
  const path = process.env.SF_NUDGE_APEX_PATH || '/services/apexrest/nudge';
  const url = `${token.instance_url.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recordId, transcriptChunk, fullTranscript }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Nudge endpoint failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  // Expect { nudges: [{ priority, title, detail }] }
  return json.nudges || [];
}

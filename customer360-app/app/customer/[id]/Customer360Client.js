'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Recorder from './Recorder';

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}

function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The Lead Description is a machine-built voice-agent summary like:
//   "--- Velo Voice Agent call summary --- Interested model: … Budget: …
//    Test ride: 2026-09-17 6:00 PM Booking #: MH-TR-DEMO-001"
// Split it into readable label/value rows. We split ONLY at known labels (not at
// every colon) so values that contain a colon — e.g. "6:00 PM" — stay intact.
const SUMMARY_LABELS = [
  'Interested model', 'Model interest', 'Model of interest',
  'Budget', 'Budget range',
  'Purchase timeframe', 'Timeframe', 'Purchase timeline',
  'Preferred dealership', 'Dealership',
  'Test ride', 'Test drive',
  'Booking #', 'Booking number', 'Booking',
  'Trade-in', 'Trade in', 'Other vehicles',
  'Financing', 'Finance',
  'Notes',
];

function parseCallSummary(raw) {
  if (!raw) return null;
  const text = String(raw);
  const header = text.match(/---\s*(.*?)\s*---/);
  // Only treat it as a structured summary when it carries the summary header.
  if (!header) return null;
  const title = header[1].trim() || 'Call Summary';
  const body = text.slice(header.index + header[0].length).trim();
  if (!body) return null;

  const markers = [];
  for (const label of SUMMARY_LABELS) {
    // label must sit at a word boundary and be followed by a colon
    const re = new RegExp(`(?:^|\\s)(${escapeReg(label)})\\s*:`, 'i');
    const m = re.exec(body);
    if (m) markers.push({ label, start: m.index + m[0].indexOf(m[1]), valueStart: m.index + m[0].length });
  }
  if (!markers.length) return null;
  markers.sort((a, b) => a.start - b.start);

  const items = markers
    .map((mk, i) => {
      const end = i + 1 < markers.length ? markers[i + 1].start : body.length;
      const value = body.slice(mk.valueStart, end).trim().replace(/\s+/g, ' ').replace(/[·•]+$/, '').trim();
      return { label: mk.label, value };
    })
    .filter((it) => it.value);

  return items.length ? { title, items } : null;
}

// Pick a short hero subtitle when the description is a parsed call summary.
function heroHeadlineFrom(summary, fallback) {
  if (!summary) return fallback;
  const model = summary.items.find((i) => /model|interest/i.test(i.label));
  return model ? `Interested in ${model.value}` : summary.title;
}

export default function Customer360Client({ id }) {
  const [state, setState] = useState({ loading: true, error: '', source: '', customer: null });
  // Whole-conversation transcript handed up by the Recorder when recording stops;
  // drives the post-conversation Sales Pitch Coach panel below the pitch.
  const [coachTranscript, setCoachTranscript] = useState('');

  useEffect(() => {
    let alive = true;
    fetch(`/api/customer/${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!alive) return;
        setState({ loading: false, error: json.error || '', source: json.source, customer: json.customer });
      })
      .catch((e) => alive && setState({ loading: false, error: String(e), source: '', customer: null }));
    return () => { alive = false; };
  }, [id]);

  if (state.loading) {
    return (
      <>
        <Header />
        <div className="center-screen"><div><div className="spinner" />Loading Customer 360…</div></div>
      </>
    );
  }

  const c = state.customer;
  if (!c) {
    return (
      <>
        <Header />
        <div className="center-screen"><div>Could not load customer.<br /><Link href="/">← Scan again</Link></div></div>
      </>
    );
  }

  const isLive = state.source === 'salesforce';
  const callSummary = parseCallSummary(c.headline);
  const heroHeadline = heroHeadlineFrom(callSummary, c.headline);

  return (
    <>
      <Header />
      <div className="content">
        <div className="hero">
          <div className="avatar">{initials(c.name)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="name">{c.name}</div>
            {heroHeadline ? <div className="headline">{heroHeadline}</div> : null}
            <span className={`badge-src ${isLive ? 'salesforce' : 'mock'}`}>
              {isLive ? 'Live · Salesforce' : 'Demo data'}
            </span>
          </div>
        </div>

        {state.error && state.source === 'mock-fallback' ? (
          <div className="warn">Live org call failed, showing demo data. ({state.error})</div>
        ) : null}

        {callSummary ? <CallSummary summary={callSummary} /> : null}

        {/* Personalized pitch the rep can use with the customer — generated from
            the lead record right after the voice-agent summary. Leads only. */}
        {c.recordType === 'Lead' ? <PitchSection recordId={c.id || id} /> : null}

        {/* Post-conversation coaching — appears once a recording is stopped. */}
        {coachTranscript ? <CoachSection transcript={coachTranscript} /> : null}

        {(c.score || c.status) ? <Overview score={c.score} status={c.status} /> : null}

        {c.vehicleInterest ? <VehicleInterest vi={c.vehicleInterest} qualification={c.qualification} /> : null}

        {c.fields?.length ? (
          <div className="section">
            <h2>Contact</h2>
            <div className="card grid2">
              {c.fields.map((f, i) => (
                <div className="kv" key={i}>
                  <div className="k">{f.label}</div>
                  <div className="v">{f.value}</div>
                </div>
              ))}
            </div>
            {(c.tags?.length || c.consent?.length) ? (
              <div className="tagrow">
                {c.tags?.map((t, i) => <span className="tag" key={`t${i}`}>{t}</span>)}
                {c.consent?.map((t, i) => <span className="tag tag--warn" key={`c${i}`}>⚠ {t}</span>)}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Real AI calling history */}
        {c.aiCalls?.length ? (
          <Panel title="AI Calling History" count={c.aiCalls.length}>
            <AiCalls calls={c.aiCalls} />
          </Panel>
        ) : null}

        {c.humanCalls?.length ? (
          <CollapsiblePanel title="Human Calling History" count={c.humanCalls.length} badge="Demo">
            <HumanCalls calls={c.humanCalls} />
          </CollapsiblePanel>
        ) : null}

        {c.vehicles?.length ? (
          <Panel title="Vehicles" count={c.vehicles.length}>
            <ListSection items={c.vehicles} statusKind={(s) => (s === 'Healthy' ? 'ok' : 'medium')} />
          </Panel>
        ) : null}
        {c.cases?.length ? (
          <Panel title="Open Cases" count={c.cases.length}>
            <ListSection items={c.cases} statusKey="priority" statusKind={priorityKind} />
          </Panel>
        ) : null}
        {c.appointments?.length ? (
          <Panel title="Activities" count={c.appointments.length}>
            <ListSection items={c.appointments} statusKind={() => 'low'} />
          </Panel>
        ) : null}
        {c.serviceHistory?.length ? (
          <Panel title="Service History" count={c.serviceHistory.length}>
            <ListSection items={c.serviceHistory} />
          </Panel>
        ) : null}
      </div>

      <Recorder recordId={c.scannedId || c.id} onCoachTranscript={setCoachTranscript} />
    </>
  );
}

/* ---------- Voice-agent call summary (parsed from Description) ---------- */
function CallSummary({ summary }) {
  return (
    <div className="section">
      <h2>✨ Voice Agent Summary</h2>
      <div className="card grid2 sumgrid">
        {summary.items.map((it, i) => (
          <div className="kv" key={i}>
            <div className="k">{it.label}</div>
            <div className="v">{it.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Personalized pitch (Personalized_Pitch_Suggestion prompt) ---------- */
function PitchSection({ recordId }) {
  const [st, setSt] = useState({ loading: true, error: '', pitch: null });

  useEffect(() => {
    let alive = true;
    setSt({ loading: true, error: '', pitch: null });
    fetch('/api/pitch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordId }),
    })
      .then((r) => r.json())
      .then((j) => { if (alive) setSt({ loading: false, error: j.error || '', pitch: j.pitch || null }); })
      .catch((e) => { if (alive) setSt({ loading: false, error: String(e), pitch: null }); });
    return () => { alive = false; };
  }, [recordId]);

  if (st.loading) {
    return (
      <div className="section">
        <h2>✨ Personalized Pitch</h2>
        <div className="card pitch pitch--loading">
          <span className="pitch__loadtext">Crafting a personalized pitch</span>
          <span className="pitch__dots"><i /><i /><i /></span>
        </div>
      </div>
    );
  }

  const p = st.pitch;
  if (!p) return null; // hard failure with no fallback — stay quiet

  const Block = ({ icon, label, text, items, close }) => (
    <div className={`pitch__block${close ? ' pitch__block--close' : ''}`}>
      <div className="pitch__label"><span className="pitch__ic">{icon}</span>{label}</div>
      {text ? <p className="pitch__text">{text}</p> : null}
      {items?.length ? (
        <ul className="pitch__list">
          {items.map((q, i) => <li key={i}>{q}</li>)}
        </ul>
      ) : null}
    </div>
  );

  return (
    <div className="section">
      <h2>✨ Personalized Pitch</h2>
      <div className="card pitch">
        <div className="pitch__top">
          <div className="pitch__who">
            {p.customerName ? <div className="pitch__name">{p.customerName}</div> : null}
            {p.vehicleInterest ? <div className="pitch__veh">🚙 {p.vehicleInterest}</div> : null}
          </div>
          {p.tone ? <span className="pitch__tone">{p.tone}</span> : null}
        </div>

        {p.leadContext ? <p className="pitch__context">{p.leadContext}</p> : null}

        {p.openingPitch ? <Block icon="🗣️" label="Opening" text={p.openingPitch} /> : null}
        {p.discoveryQuestions?.length ? <Block icon="❓" label="Discovery Questions" items={p.discoveryQuestions} /> : null}
        {p.personalizedValuePitch ? <Block icon="💎" label="Value Pitch" text={p.personalizedValuePitch} /> : null}
        {p.testDriveFocus?.length ? <Block icon="🏁" label="Test Drive Focus" items={p.testDriveFocus} /> : null}
        {p.closingPitch ? <Block icon="🤝" label="Closing" text={p.closingPitch} close /> : null}
      </div>
    </div>
  );
}

/* ---------- Sales Pitch Coach (Sales_Pitch_Coach prompt, post-conversation) ---------- */
function CoachSection({ transcript }) {
  const [st, setSt] = useState({ loading: true, error: '', coach: null });

  useEffect(() => {
    let alive = true;
    setSt({ loading: true, error: '', coach: null });
    fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript }),
    })
      .then((r) => r.json())
      .then((j) => { if (alive) setSt({ loading: false, error: j.error || '', coach: j.coach || null }); })
      .catch((e) => { if (alive) setSt({ loading: false, error: String(e), coach: null }); });
    return () => { alive = false; };
  }, [transcript]);

  if (st.loading) {
    return (
      <div className="section">
        <h2>🎯 Pitch Coach</h2>
        <div className="card coach coach--loading">
          <span className="coach__loadtext">Analyzing your pitch</span>
          <span className="coach__dots"><i /><i /><i /></span>
        </div>
      </div>
    );
  }

  const c = st.coach;
  if (!c) return null; // hard failure with no fallback — stay quiet

  return (
    <div className="section">
      <h2>🎯 Pitch Coach</h2>
      <div className="card coach">
        {c.summary ? (
          <div className="coach__block">
            <div className="coach__label"><span className="coach__ic">📝</span>Summary of the Pitch</div>
            <p className="coach__text">{c.summary}</p>
          </div>
        ) : null}

        {c.good?.length ? (
          <div className="coach__block coach__block--good">
            <div className="coach__label"><span className="coach__ic">✅</span>Where You Did Good</div>
            <ul className="coach__list coach__list--good">
              {c.good.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          </div>
        ) : null}

        {c.improve?.length ? (
          <div className="coach__block coach__block--improve">
            <div className="coach__label"><span className="coach__ic">⚡</span>Where You Can Improve</div>
            <ul className="coach__list coach__list--improve">
              {c.improve.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          </div>
        ) : null}

        {c.improvedPitch ? (
          <div className="coach__block coach__block--pitch">
            <div className="coach__label"><span className="coach__ic">🎤</span>Improved Pitch to Practice</div>
            <p className="coach__pitch">“{c.improvedPitch}”</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- Always-open titled section ---------- */
function Panel({ title, count, badge, children }) {
  return (
    <div className="section">
      <h2 className="panel-h2">
        <span>{title}</span>
        {count != null ? <span className="acc-count">{count}</span> : null}
        {badge ? <span className="tag acc-badge">{badge}</span> : null}
      </h2>
      {children}
    </div>
  );
}

/* ---------- Collapsible titled section (collapsed by default) ---------- */
function CollapsiblePanel({ title, count, badge, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => setOpen((o) => !o);
  return (
    <div className="section">
      <h2
        className="panel-h2 is-toggle"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        }}
      >
        <span>{title}</span>
        {count != null ? <span className="acc-count">{count}</span> : null}
        {badge ? <span className="tag acc-badge">{badge}</span> : null}
        <span className={`panel-chev ${open ? 'open' : ''}`} aria-hidden>▸</span>
      </h2>
      {open ? children : null}
    </div>
  );
}

/* ---------- At-a-glance overview: score + band + status + drivers ---------- */
function Overview({ score, status }) {
  const bandPill = score ? (score.bandKind === 'high' ? 'high' : score.bandKind === 'medium' ? 'medium' : 'low') : 'low';
  return (
    <div className="section">
      <h2>At a Glance</h2>
      <div className="card overview">
        <div className="ov-top">
          {score ? (
            <div className={`score-ring score-ring--${score.bandKind}`} style={{ '--pct': Math.min(100, score.value) }}>
              <div className="score-ring__num">{score.value}</div>
              <div className="score-ring__of">/100</div>
            </div>
          ) : null}
          <div className="ov-meta">
            <div className="ov-badges">
              {score ? <span className={`pill ${bandPill}`}>{score.band}</span> : null}
              {status ? <span className={`pill ${status.current === 'Converted' ? 'ok' : 'high'}`}>{status.current}</span> : null}
            </div>
            {status ? (
              <div className="ov-sub">{[status.ageLabel, `Last activity ${status.lastActivity}`].filter(Boolean).join(' · ')}</div>
            ) : null}
            {score ? (
              <div className="drivers ov-drivers">
                {score.drivers.map((d, i) => (
                  <div className="driver" key={i}>
                    <div className="driver__top">
                      <span className="driver__label">{d.label}</span>
                      <span className="driver__pts">{d.pts}/{d.max}</span>
                    </div>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.round((d.pts / d.max) * 100)}%` }} /></div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        {status ? (
          <div className="steps ov-steps">
            {status.steps.map((s, i) => (
              <div className={`step step--${s.state}`} key={i}>
                <span className="step__dot">{s.state === 'done' ? '✓' : i + 1}</span>
                <span className="step__label">{s.label}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- Vehicle interest + qualification tiles ---------- */
function VehicleInterest({ vi, qualification }) {
  return (
    <div className="section">
      <h2>Vehicle Interest</h2>
      <div className="card">
        <div className="vi">
          <div className="vi__icon">🚙</div>
          <div className="vi__meta">
            <div className="vi__eyebrow">Interested Model</div>
            <div className="vi__model">{vi.model}</div>
            <div className="vi__sub">{vi.sub}</div>
          </div>
          <span className={`pill ${vi.testDriveKind}`}>{vi.testDrive}</span>
        </div>
        {qualification?.length ? (
          <div className="grid2 qual">
            {qualification.map((q, i) => (
              <div className="kv" key={i}>
                <div className="k">{q.label}</div>
                <div className="v">{q.value}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- AI call history ---------- */
function AiCalls({ calls }) {
  return (
    <>
      {calls.map((c) => (
        <div className="card callcard" key={c.id}>
          <div className="callcard__head">
            <span className="ai-badge">✨</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <span className="callcard__title">{c.title}</span>
              <div className="callcard__meta">{[c.direction, c.duration, c.date].filter(Boolean).join(' · ')}</div>
            </div>
            {c.sentiment ? <span className={`pill ${c.sentimentKind}`}>{c.sentiment}</span> : null}
          </div>
          {(c.disposition || c.recorded || c.ref) ? (
            <div className="tagrow">
              {c.disposition ? <span className="pill low">{c.disposition}</span> : null}
              {c.recorded ? <span className="tag">🎙 Recorded</span> : null}
              {c.ref ? <span className="tag">{c.ref}</span> : null}
            </div>
          ) : null}
          {c.summary ? <div className="callcard__summary">{c.summary}</div> : null}
        </div>
      ))}
    </>
  );
}

/* ---------- Human call history ---------- */
function HumanCalls({ calls }) {
  return (
    <>
      {calls.map((c) => (
        <div className="card callcard" key={c.id}>
          <div className="callcard__head">
            <span className="mini-avatar">{initials(c.advisor)}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <span className="callcard__title">{c.title}</span>
              <div className="callcard__meta">{c.advisor} · {c.role}</div>
            </div>
            <span className={`pill ${c.sentimentKind}`}>{c.sentiment}</span>
          </div>
          <div className="callcard__meta">{c.direction} · {c.duration} · {c.date}</div>
          <div className="meter">
            <div className="meter__head"><span>Sentiment</span><span>{c.score}/100</span></div>
            <div className="bar-track">
              <div className={`bar-fill ${c.score >= 70 ? 'bar-fill--pos' : c.score >= 45 ? 'bar-fill--warn' : 'bar-fill--neg'}`} style={{ width: `${c.score}%` }} />
            </div>
          </div>
          <div className="callcard__summary">{c.summary}</div>
        </div>
      ))}
    </>
  );
}

function priorityKind(p = '') {
  const v = p.toLowerCase();
  if (v === 'high') return 'high';
  if (v === 'medium') return 'medium';
  return 'low';
}

function ListSection({ items, statusKey = 'status', statusKind }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="card">
      {items.map((it) => {
        const status = it[statusKey] || it.status;
        return (
          <div className="list-item" key={it.id}>
            <div style={{ flex: 1 }}>
              <div className="li-title">{it.name || it.subject}</div>
              {it.subtitle ? <div className="li-sub">{it.subtitle}</div> : null}
              {it.meta ? <div className="li-meta">{it.meta}</div> : null}
            </div>
            {status ? <span className={`pill ${statusKind ? statusKind(status) : 'low'} ml-auto`}>{status}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function Header() {
  return (
    <div className="topbar">
      <div className="logo">M</div>
      <div>
        <h1>Customer 360</h1>
        <div className="sub">Service center check-in</div>
      </div>
      <Link href="/" className="back">↺ New scan</Link>
    </div>
  );
}

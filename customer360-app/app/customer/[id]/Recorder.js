'use client';

import { useEffect, useRef, useState } from 'react';

const CHUNK_MS = 20_000; // call the Salesforce prompt every ~20 seconds

export default function Recorder({ recordId, onCoachTranscript }) {
  const [supported, setSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [lang, setLang] = useState('hi-IN');
  const [interim, setInterim] = useState('');
  const [finalText, setFinalText] = useState('');
  const [nudges, setNudges] = useState([]);
  const [thinking, setThinking] = useState(false);
  const [nudgesHidden, setNudgesHidden] = useState(false);

  const recogRef = useRef(null);
  const recordingRef = useRef(false);
  const fullRef = useRef('');       // finalized transcript (stable)
  const interimRef = useRef('');    // current in-progress phrase (not yet final)
  const consumedRef = useRef('');   // exact transcript text already dispatched for analysis
  const conversationRef = useRef('');// whole conversation from start (fed to the pitch coach on stop)
  const inFlightRef = useRef(false);// a /api/nudge call is currently running
  const timerRef = useRef(null);
  // Rolling coaching context fed back into the Showroom_Nudge_Flex prompt each call.
  const summaryRef = useRef('');
  const phaseRef = useRef('');
  const lastNudgeRef = useRef('');

  useEffect(() => {
    const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) setSupported(false);
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;

    r.onresult = (event) => {
      let interimStr = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const txt = res[0].transcript;
        if (res.isFinal) {
          fullRef.current += txt + ' ';
          setFinalText(fullRef.current);
        } else {
          interimStr += txt;
        }
      }
      // Keep the live interim phrase so flushChunk can analyse speech even before
      // Chrome commits it as final (Chrome only finalizes at pauses / its ~60s
      // session cycle — waiting for that would stall the nudges by up to a minute).
      interimRef.current = interimStr;
      setInterim(interimStr);
    };

    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setSupported(false);
        stop();
      }
    };

    // Web Speech stops itself periodically; restart while still recording.
    r.onend = () => {
      if (recordingRef.current) {
        try { r.start(); } catch { /* already starting */ }
      }
    };
    return r;
  }

  // Returns the new (undispatched) words since the last call and, when there are
  // any, advances the marker and appends them to the running whole-conversation
  // transcript. Shared by the per-interval nudge flush and the stop() handler.
  //
  // Best-known transcript so far = stable finalized text + the current in-progress
  // interim phrase. We reconcile against COMBINED text (not finalized-only) so
  // continuous speech Chrome hasn't committed yet is never dropped between
  // intervals — and we never stop/restart the recognizer (which would lose the
  // audio spoken during the restart gap, the cause of vanishing mid-sentence words).
  function pullNewText() {
    const combined = (fullRef.current + interimRef.current).replace(/\s+/g, ' ').trim();

    // New words = combined minus the prefix already consumed. Longest-common-prefix
    // reconciliation means interim revisions (Chrome rewrites the last few words as
    // it recognises them) only re-send those words instead of drifting to a wrong
    // offset or skipping content entirely.
    const consumed = consumedRef.current;
    const max = Math.min(consumed.length, combined.length);
    let i = 0;
    while (i < max && consumed[i] === combined[i]) i++;
    const chunk = combined.slice(i).trim();

    if (chunk.replace(/\s/g, '').length < 2) return ''; // nothing new worth sending
    consumedRef.current = combined; // everything up to here is now consumed
    conversationRef.current = conversationRef.current ? `${conversationRef.current} ${chunk}` : chunk;
    return chunk;
  }

  async function flushChunk() {
    // Skip if a previous analysis is still running so slow prompt calls don't pile up.
    if (inFlightRef.current) return;

    const chunk = pullNewText();
    if (!chunk) return;

    inFlightRef.current = true;
    setThinking(true);
    try {
      const res = await fetch('/api/nudge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId,
          transcriptChunk: chunk, // just this interval's new words
          // rolling context so the prompt can track the whole conversation
          rollingSummary: summaryRef.current,
          currentPhase: phaseRef.current,
          lastNudgeText: lastNudgeRef.current,
        }),
      });
      const json = await res.json();
      // Persist the rolling context returned by the prompt for the next call.
      if (json.context) {
        summaryRef.current = json.context.rollingSummary || summaryRef.current;
        phaseRef.current = json.context.phase || phaseRef.current;
        lastNudgeRef.current = json.context.lastNudgeText || lastNudgeRef.current;
      }
      const incoming = (json.nudges || []).map((n, i) => ({ ...n, _id: `${Date.now()}-${i}` }));
      if (incoming.length) setNudges((prev) => [...incoming, ...prev].slice(0, 12));
    } catch {
      /* ignore transient errors, keep listening */
    } finally {
      inFlightRef.current = false;
      setThinking(false);
    }
  }

  function start() {
    if (!supported) return;
    setNudges([]);
    setNudgesHidden(false);
    fullRef.current = '';
    interimRef.current = '';
    consumedRef.current = '';
    conversationRef.current = '';
    inFlightRef.current = false;
    summaryRef.current = '';
    phaseRef.current = '';
    lastNudgeRef.current = '';
    setFinalText('');
    setInterim('');
    onCoachTranscript?.(''); // clear any prior pitch-coach panel for the new session
    recordingRef.current = true;
    setRecording(true);

    const r = buildRecognition();
    recogRef.current = r;
    try { r.start(); } catch { /* noop */ }

    timerRef.current = setInterval(flushChunk, CHUNK_MS);
  }

  function stop() {
    recordingRef.current = false;
    setRecording(false);
    setInterim('');
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (recogRef.current) {
      try { recogRef.current.stop(); } catch { /* noop */ }
      recogRef.current = null;
    }
    // Send whatever is left so the last words still generate a nudge, then make
    // sure the full conversation is captured for the coach even if that final
    // flush was skipped because a nudge call was still in flight.
    flushChunk();
    pullNewText();
    const conversation = conversationRef.current.trim();
    if (conversation.replace(/\s/g, '').length >= 10) onCoachTranscript?.(conversation);
  }

  function toggle() {
    recording ? stop() : start();
  }

  function dismiss(id) {
    setNudges((prev) => prev.filter((n) => n._id !== id));
  }

  return (
    <>
      {/* Live nudges surface as fixed toasts pinned below the topbar, newest
          first, and scroll within a bounded region so they never push the
          record dock or the 360 content. */}
      {nudges.length > 0 || recording ? (
        <div className="nudge-toasts" role="log" aria-live="polite">
          <div className="nudge-toasts__hd">
            <span>Live nudges</span>
            {nudges.length ? <span className="nudge-toasts__n">{nudges.length}</span> : null}
            {thinking && !nudgesHidden ? <span className="nudge-toasts__spin">· analysing…</span> : null}
            <button
              className="nudge-toasts__toggle"
              onClick={() => setNudgesHidden((h) => !h)}
              aria-expanded={!nudgesHidden}
              aria-label={nudgesHidden ? 'Show nudges' : 'Hide nudges'}
            >
              {nudgesHidden ? 'Show' : 'Hide'}
            </button>
          </div>
          {!nudgesHidden ? (
            <div className="nudge-toasts__scroll">
              {nudges.length === 0 ? (
                <div className="empty nudge-toasts__empty">Listening… suggestions appear every ~20 seconds.</div>
              ) : (
                nudges.map((n) => (
                  <div className={`nudge ${n.priority || 'low'}`} key={n._id}>
                    <button className="nudge__x" onClick={() => dismiss(n._id)} aria-label="Dismiss nudge">×</button>
                    <div className="nt">
                      <span>{n.priority === 'high' ? '🔴' : n.priority === 'medium' ? '🟠' : '🔵'}</span>
                      {n.title}
                    </div>
                    <div className="nd">{n.detail}</div>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="dock">
        <div className="dock-row">
          <button className={`mic ${recording ? 'recording' : ''}`} onClick={toggle} aria-label="Record">
            {recording ? '■' : '🎙'}
          </button>
          <div style={{ flex: 1 }}>
            <div className="status">
              {recording ? 'Recording conversation…' : supported ? 'Tap to record & get nudges' : 'Speech recognition unavailable'}
              <small>
                {supported
                  ? recording
                    ? `Transcribing (${lang}) · prompt every 20s`
                    : 'Uses your phone mic · Android Chrome recommended'
                  : 'Try Android Chrome, or type notes on the record instead.'}
              </small>
            </div>
          </div>
          {!recording && supported ? (
            <button
              className="btn ghost"
              onClick={() => setLang((l) => (l === 'hi-IN' ? 'en-IN' : 'hi-IN'))}
              style={{ padding: '8px 12px', fontSize: 13 }}
            >
              {lang === 'hi-IN' ? 'हिंदी' : 'EN'}
            </button>
          ) : null}
        </div>

        {recording && (finalText || interim) ? (
          <div className="transcript">
            {finalText}
            <span className="interim"> {interim}</span>
          </div>
        ) : null}
      </div>
    </>
  );
}

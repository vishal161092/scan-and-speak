import { NextResponse } from 'next/server';
import { sfConfigured, getShowroomNudge, updateNudgeRecord } from '@/lib/salesforce';
import { getMockNudges } from '@/lib/mock';

export const dynamic = 'force-dynamic';

// Maps the prompt's confidence to the app's nudge priority styling.
function priorityFromConfidence(conf = '') {
  const c = String(conf).toLowerCase();
  if (c === 'high') return 'high';
  if (c === 'medium') return 'medium';
  return 'low';
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    recordId = '',
    transcriptChunk = '',
    rollingSummary = '',
    currentPhase = '',
    lastNudgeText = '',
  } = body || {};

  // No live org configured → keyword demo nudges, no rolling context.
  if (!sfConfigured()) {
    return NextResponse.json({
      source: 'mock',
      nudges: getMockNudges(transcriptChunk),
      context: { rollingSummary, phase: currentPhase, lastNudgeText },
    });
  }

  try {
    const out = await getShowroomNudge({
      latestTranscript: transcriptChunk,
      rollingSummary,
      currentPhase,
      lastNudgeText,
    });

    // Keep the Nudge__c record in sync with the latest coaching nudge. Best-effort:
    // a write failure shouldn't stop the rep from seeing the nudge on their phone.
    let nudgeUpdate = 'ok';
    try {
      await updateNudgeRecord({
        nudge: out,
        nowIso: new Date().toISOString(),
        transcriptChunk,
      });
    } catch (e) {
      nudgeUpdate = String(e.message || e);
    }

    // Carry the rolling state back to the client for the next 10s call.
    const context = {
      rollingSummary: out.rollingSummary || rollingSummary,
      phase: out.phase || currentPhase,
      lastNudgeText: out.longNudge || lastNudgeText,
    };

    // Only surface a card when the model says this nudge is materially new,
    // so the top-of-list nudge doesn't repeat every 10 seconds.
    const nudges =
      out.longNudge && out.isNew !== false
        ? [
            {
              priority: priorityFromConfidence(out.confidence),
              title: out.topic || 'Coaching nudge',
              detail: out.longNudge,
            },
          ]
        : [];

    return NextResponse.json({ source: 'salesforce', nudges, context, nudgeUpdate });
  } catch (err) {
    return NextResponse.json({
      source: 'mock-fallback',
      error: String(err.message || err),
      nudges: getMockNudges(transcriptChunk),
      context: { rollingSummary, phase: currentPhase, lastNudgeText },
    });
  }
}

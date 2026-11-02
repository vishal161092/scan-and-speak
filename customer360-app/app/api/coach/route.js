import { NextResponse } from 'next/server';
import { sfConfigured, getSalesPitchCoach } from '@/lib/salesforce';

export const dynamic = 'force-dynamic';

// Demo coaching shown when no live org is configured (or the prompt call fails),
// so the mobile experience still looks complete during offline demos.
const MOCK_COACH = {
  summary:
    "The customer opened by asking for details about a car to purchase and outlined clear priorities: good sound quality, strong build and safety for their children, and reliable suspension and brakes for family use. The salesperson did not present product features, a value proposition, or handle the stated concerns — the only response was to promise details and ask for a phone number.",
  good: [
    "Acknowledged the customer's request and committed to sharing full details, keeping the conversation going.",
    'Attempted to secure a next step by asking for the phone number, keeping the lead active for follow-up.',
  ],
  improve: [
    'Missed discovery opportunity — three clear priorities were stated but no clarifying questions were asked. Acknowledge each need and ask two or three targeted questions before offering options.',
    'No value proposition delivered — map each concern to a concrete feature (NCAP rating for child safety, a specific audio system for sound quality, suspension type for ride comfort).',
    "Children's safety was never addressed — lead with airbags, ISOFIX mounts, ABS and body-structure ratings when a family customer raises this.",
    'Premature request for contact details — share a short, relevant overview first, then ask for details to send a brochure or book a test drive.',
    'No clear next step beyond the phone number — propose a showroom visit, a test-drive slot, or a follow-up call at an agreed time.',
  ],
  improvedPitch:
    'Thank you for sharing your requirements. Based on what you have described — safety for your children, sound quality, and reliable suspension and brakes — I recommend we look at models with a four or five-star safety rating, dual front airbags, ISOFIX child-seat anchors, and ABS with EBD as standard. For sound, several options here offer factory-fitted audio tuned for cabin acoustics, and I will walk you through variants with all-wheel disc brakes and a suspension setup suited to city and highway family use. To respect your time, may I suggest a fifteen-minute showroom visit or a test drive at your convenience. If you share your phone number and preferred time, I will send a short comparison of two or three models that match your priorities before we meet.',
};

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const transcript = String((body && body.transcript) || '').trim();
  if (transcript.replace(/\s/g, '').length < 10) {
    return NextResponse.json({ error: 'transcript too short to coach' }, { status: 400 });
  }

  // No live org configured → demo coaching.
  if (!sfConfigured()) {
    return NextResponse.json({ source: 'mock', coach: MOCK_COACH });
  }

  try {
    const coach = await getSalesPitchCoach(transcript);
    return NextResponse.json({ source: 'salesforce', coach });
  } catch (err) {
    return NextResponse.json({
      source: 'mock-fallback',
      error: String(err.message || err),
      coach: MOCK_COACH,
    });
  }
}

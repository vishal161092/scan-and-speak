import { NextResponse } from 'next/server';
import { sfConfigured, getPersonalizedPitch } from '@/lib/salesforce';

export const dynamic = 'force-dynamic';

// Demo pitch shown when no live org is configured (or the prompt call fails), so
// the mobile experience still looks complete during offline demos.
const MOCK_PITCH = {
  customerName: 'Arjun Sharma',
  vehicleInterest: 'Velo Orion X7',
  leadContext:
    'Arjun Sharma is a Business Owner at Sharma Enterprises, based in Pune. He reached out through the website and had a follow-up voice interaction. He has shown interest in the Velo Orion X7, with a budget in the 40 to 50 lakhs range and a purchase timeframe of three to four months. Velo Kothrud is his preferred dealership, and his test drive is scheduled at 6:00 PM.',
  openingPitch:
    'Welcome to Velo Kothrud, Mr. Sharma. Thank you for making the time to visit us today. The Orion X7 is ready for you, and we should have a productive session lined up around it.',
  discoveryQuestions: [
    "What draws you to the Orion X7 specifically, and what would you like to focus on during today's drive.",
    'Between daily city use and longer highway drives, where do you expect the vehicle to spend most of its time.',
  ],
  personalizedValuePitch:
    'The Orion X7 is positioned as a flagship offering and sits well within the range you have in mind. Given your role at Sharma Enterprises, the drive today should give you a clear sense of how the vehicle balances presence, comfort, and everyday usability.',
  testDriveFocus: [
    'Cabin comfort and rear-seat experience for business travel.',
    'Drive dynamics and ride quality across varied road conditions around Baner and Kothrud.',
  ],
  closingPitch:
    'Once you are back from the drive, we should sit down over a coffee and walk through the variants and next steps that align with your three to four month timeline. I will make sure your time here is well spent.',
  tone: 'Warm, conversational and professional',
};

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { recordId = '' } = body || {};
  if (!recordId) {
    return NextResponse.json({ error: 'recordId is required' }, { status: 400 });
  }

  // No live org configured → demo pitch.
  if (!sfConfigured()) {
    return NextResponse.json({ source: 'mock', pitch: MOCK_PITCH });
  }

  try {
    const pitch = await getPersonalizedPitch(recordId);
    return NextResponse.json({ source: 'salesforce', pitch });
  } catch (err) {
    return NextResponse.json({
      source: 'mock-fallback',
      error: String(err.message || err),
      pitch: MOCK_PITCH,
    });
  }
}

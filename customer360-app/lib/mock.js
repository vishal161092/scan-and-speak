// Mock Customer 360 data. Used when Salesforce env vars are not configured,
// or when USE_MOCK=true. Keyed loosely so any scanned id resolves to a demo
// customer, which keeps the scan-to-360 flow demoable without a live org.

const RAHUL = {
  id: '003DEMO000000001',
  recordType: 'Contact',
  name: 'Rahul Sharma',
  photoUrl: '',
  headline: 'Loyalty: Gold • Customer since 2019',
  fields: [
    { label: 'Phone', value: '+91 98200 12345' },
    { label: 'Email', value: 'rahul.sharma@example.com' },
    { label: 'City', value: 'Pune' },
    { label: 'Preferred Language', value: 'Hindi' },
    { label: 'Loyalty Tier', value: 'Gold' },
    { label: 'Lifetime Value', value: '₹ 24,80,000' },
  ],
  vehicles: [
    {
      id: 'a01DEMO000000001',
      name: 'Velo Ranger LX 4x4',
      subtitle: 'MH-12 AB 4455 • Diesel • 2022',
      status: 'Service due',
      meta: 'Last service: 12 Mar 2026 • 18,240 km',
    },
    {
      id: 'a01DEMO000000002',
      name: 'Velo Orion X5 Summit',
      subtitle: 'MH-12 CD 7788 • Petrol • 2024',
      status: 'Healthy',
      meta: 'Last service: 02 Aug 2026 • 9,110 km',
    },
  ],
  cases: [
    {
      id: 'case-demo-1',
      subject: 'AC not cooling on Ranger',
      status: 'In Progress',
      priority: 'High',
      meta: 'Opened 09 Sep 2026 • Case #00043211',
    },
    {
      id: 'case-demo-2',
      subject: 'Infotainment software update request',
      status: 'New',
      priority: 'Medium',
      meta: 'Opened 13 Sep 2026 • Case #00043298',
    },
  ],
  appointments: [
    {
      id: '08pDEMO000000001',
      name: 'Periodic Service — Ranger',
      subtitle: 'Kothrud Service Center',
      status: 'Scheduled',
      meta: 'Today • 11:00 AM',
    },
  ],
  serviceHistory: [
    { id: 'h1', name: 'Periodic Service (30,000 km)', meta: '12 Mar 2026 • ₹ 14,200' },
    { id: 'h2', name: 'Tyre replacement (x2)', meta: '20 Nov 2025 • ₹ 26,500' },
    { id: 'h3', name: 'Warranty inspection', meta: '05 Jun 2025 • No charge' },
  ],
};

// ---- Omni-channel activity + call history (demo content, mirrors the desktop
// 360 LWCs). Attached to every 360 payload so the phone shows the same story. ----
export const LEAD_TIMELINE = [
  { id: 1, channel: 'Human Call', kind: 'accent', title: 'Test drive coordination', desc: 'Dev Mehta locked Sat 11 AM slot', when: 'Today · 2:10 PM' },
  { id: 2, channel: 'AI Call', kind: 'ai', title: 'Velo Orion X7 follow-up', desc: 'Confirmed Summit L diesel AT interest', when: 'Today · 11:24 AM' },
  { id: 3, channel: 'WhatsApp', kind: 'pos', title: 'Price & brochure shared', desc: 'On-road quote + exchange estimate sent', when: 'Today · 9:05 AM' },
  { id: 4, channel: 'Email', kind: 'info', title: 'Velo Orion X7 brochure', desc: "Opened · clicked 'Book test drive'", when: 'Yesterday · 7:20 PM' },
  { id: 5, channel: 'AI Call', kind: 'ai', title: 'Finance options query', desc: 'Requested finance specialist callback', when: 'Yesterday · 6:48 PM' },
  { id: 6, channel: 'Web', kind: 'muted', title: 'Configured Velo Orion X7', desc: 'Built Summit L on velomotors.example', when: '13 Sep · 8:40 PM' },
  { id: 7, channel: 'Web Form', kind: 'muted', title: 'Website enquiry submitted', desc: 'Source of this lead', when: '12 Sep · 10:02 AM' },
];

export const AI_CALLS = [
  {
    id: 'ai1', title: 'Velo Orion X7 — Enquiry Follow-up', direction: 'Outbound', duration: '3:12', date: 'Today, 11:24 AM',
    sentiment: 'Positive', sentimentKind: 'pos', intent: 'High Purchase Intent',
    summary: 'AI assistant confirmed interest in the Velo Orion X7. Customer preferred the diesel automatic (Summit L) and asked about the on-road price in Pune and current waiting period. Intends to visit the showroom this weekend for a test drive.',
    nextAction: 'Schedule weekend test drive & share on-road quote',
  },
  {
    id: 'ai2', title: 'Finance & EMI Options', direction: 'Inbound', duration: '2:05', date: 'Yesterday, 6:48 PM',
    sentiment: 'Neutral', sentimentKind: 'warn', intent: 'Evaluating Options',
    summary: 'Customer wanted to understand financing options. AI explained EMI plans and the exchange bonus, and noted a request to compare 5-year vs 7-year tenure with a finance specialist.',
    nextAction: 'Arrange finance specialist callback with EMI comparison',
  },
  {
    id: 'ai3', title: 'Initial Qualification Call', direction: 'Outbound', duration: '4:40', date: '12 Sep, 10:20 AM',
    sentiment: 'Positive', sentimentKind: 'pos', intent: 'Qualified',
    summary: 'First-touch qualification after a web enquiry. AI captured model interest, city and rough budget. Customer is an SUV enthusiast upgrading from a hatchback and prioritises off-road capability and safety.',
    nextAction: 'Send Velo Orion X7 brochure + safety highlights',
  },
];

export const HUMAN_CALLS = [
  {
    id: 'h1', title: 'Test Drive Coordination', advisor: 'Dev Mehta', role: 'Senior Sales Advisor',
    direction: 'Outbound', date: 'Today, 2:10 PM', duration: '6:20', sentiment: 'Positive', sentimentKind: 'pos', score: 84,
    summary: 'Advisor called to lock a test-drive slot for the Velo Orion X7. Customer preferred Saturday morning at the Kothrud showroom and asked for a diesel AT unit. Advisor confirmed availability and offered a home test drive as an alternative.',
  },
  {
    id: 'h2', title: 'Price & Exchange Discussion', advisor: 'Priya Nair', role: 'Sales Consultant',
    direction: 'Inbound', date: 'Yesterday, 5:30 PM', duration: '8:45', sentiment: 'Mixed', sentimentKind: 'warn', score: 58,
    summary: 'Customer called about pricing and felt the on-road quote was slightly above budget. Some concern about the waiting period. Advisor offered an exchange bonus and a corporate discount to bridge the gap.',
  },
];

export function getMockCustomer(id) {
  return {
    ...RAHUL,
    scannedId: id || RAHUL.id,
    timeline: LEAD_TIMELINE,
    aiCalls: AI_CALLS,
    humanCalls: HUMAN_CALLS,
  };
}

// Fallback nudges when no live prompt is wired. The engine rotates through
// these based on keywords in the latest transcript chunk so the demo feels live.
export function getMockNudges(transcriptChunk = '') {
  const t = (transcriptChunk || '').toLowerCase();
  const nudges = [];

  if (t.includes('ac') || t.includes('cool') || t.includes('एसी') || t.includes('ठंड')) {
    nudges.push({
      priority: 'high',
      title: 'Address the open AC case',
      detail: 'Case #00043211 (AC not cooling) is In Progress. Confirm the fix and set expectations on turnaround.',
    });
  }
  if (t.includes('service') || t.includes('सर्विस') || t.includes('maintenance')) {
    nudges.push({
      priority: 'medium',
      title: 'Ranger service is due',
      detail: 'Ranger LX is at 18,240 km and flagged “Service due”. Offer to bundle today’s visit with the periodic service.',
    });
  }
  if (t.includes('orion') || t.includes('new') || t.includes('नई') || t.includes('buy') || t.includes('खरीद')) {
    nudges.push({
      priority: 'medium',
      title: 'Upsell opportunity',
      detail: 'Gold-tier customer, 2 vehicles. Mention the Orion X5 accessory offer and loyalty exchange bonus.',
    });
  }
  if (t.includes('warranty') || t.includes('वारंटी')) {
    nudges.push({
      priority: 'low',
      title: 'Extended warranty',
      detail: 'Ranger’s standard warranty ends in 4 months. Good moment to pitch the extended warranty plan.',
    });
  }

  if (nudges.length === 0) {
    nudges.push({
      priority: 'low',
      title: 'Keep listening',
      detail: 'Ask an open question about why the customer came in today, then let the transcript surface next best actions.',
    });
  }
  return nudges;
}

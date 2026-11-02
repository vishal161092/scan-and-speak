import { NextResponse } from 'next/server';
import { sfConfigured, getCustomer360 } from '@/lib/salesforce';
import { getMockCustomer } from '@/lib/mock';

export const dynamic = 'force-dynamic';

export async function GET(_request, { params }) {
  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: 'Missing record id' }, { status: 400 });
  }

  if (!sfConfigured()) {
    return NextResponse.json({ source: 'mock', customer: getMockCustomer(id) });
  }

  try {
    const customer = await getCustomer360(id);
    return NextResponse.json({ source: 'salesforce', customer });
  } catch (err) {
    // Fall back to mock so the demo never dead-ends, but surface the reason.
    return NextResponse.json({
      source: 'mock-fallback',
      error: String(err.message || err),
      customer: getMockCustomer(id),
    });
  }
}

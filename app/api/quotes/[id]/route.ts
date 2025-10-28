import { NextResponse } from 'next/server';
import { getQuote, saveQuote, Quote } from '@/lib/quotes';

type RouteParams = {
  params: { id: string };
};

export async function GET(_request: Request, context: RouteParams) {
  const quote = await getQuote(context.params.id);
  if (!quote) {
    return NextResponse.json({ message: 'Quote not found' }, { status: 404 });
  }
  return NextResponse.json(quote);
}

export async function PUT(request: Request, context: RouteParams) {
  const existing = await getQuote(context.params.id);
  if (!existing) {
    return NextResponse.json({ message: 'Quote not found' }, { status: 404 });
  }
  const payload = (await request.json()) as Quote;
  const updated = await saveQuote({ ...existing, ...payload, id: context.params.id });
  return NextResponse.json(updated);
}

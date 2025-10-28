import { NextResponse } from 'next/server';
import { createQuote, listQuotes, QuoteDraft } from '@/lib/quotes';

export async function GET() {
  const quotes = await listQuotes();
  return NextResponse.json(quotes);
}

export async function POST(request: Request) {
  const payload = (await request.json()) as QuoteDraft;
  const quote = await createQuote(payload);
  return NextResponse.json(quote);
}

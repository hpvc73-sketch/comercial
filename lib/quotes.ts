import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { listFiles, writeJsonFile } from './storage';
import { calculateQuoteTotals, DiscountType, QuoteInputTotals } from './calc';

export type ClientInfo = {
  name: string;
  vatNumber: string;
  email: string;
  phone: string;
  address: string;
};

export type LineItem = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  discountType: DiscountType;
  discountValue: number;
  imageData?: string;
};

export type Quote = {
  id: string;
  number: string;
  createdAt: string;
  validityDays: number;
  client: ClientInfo;
  lines: LineItem[];
  globalDiscountPercent: number;
  shippingCost: number;
  notes: string;
  totals: QuoteInputTotals;
};

export type QuoteDraft = {
  number?: string;
  createdAt?: string;
  validityDays: number;
  client: ClientInfo;
  lines: LineItem[];
  globalDiscountPercent: number;
  shippingCost: number;
  notes: string;
};

export function createQuoteDraft(): QuoteDraft {
  return {
    number: undefined,
    createdAt: undefined,
    validityDays: 30,
    client: {
      name: '',
      vatNumber: '',
      email: '',
      phone: '',
      address: ''
    },
    lines: [],
    globalDiscountPercent: 0,
    shippingCost: 0,
    notes: ''
  };
}

const QUOTES_DIR = 'quotes';

async function readQuoteFile(relativePath: string): Promise<Quote | null> {
  const filePath = path.join(process.cwd(), 'data', relativePath);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as Quote;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function listQuotes(): Promise<Quote[]> {
  const files = await listFiles(QUOTES_DIR);
  const quotes: Quote[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const quote = await readQuoteFile(path.join(QUOTES_DIR, file));
    if (quote) {
      quotes.push(quote);
    }
  }
  return quotes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getQuote(id: string): Promise<Quote | null> {
  return readQuoteFile(path.join(QUOTES_DIR, `${id}.json`));
}

export async function saveQuote(quote: Quote): Promise<Quote> {
  const totals = calculateQuoteTotals({
    lines: quote.lines,
    globalDiscountPercent: quote.globalDiscountPercent,
    shippingCost: quote.shippingCost
  });
  const data: Quote = { ...quote, totals };
  await writeJsonFile(path.join(QUOTES_DIR, `${quote.id}.json`), data);
  return data;
}

export async function createQuote(partial: QuoteDraft): Promise<Quote> {
  const id = randomUUID();
  const createdAt = partial.createdAt ? new Date(partial.createdAt) : new Date();
  const number = partial.number ?? (await generateNextQuoteNumber(createdAt));
  const totals = calculateQuoteTotals({
    lines: partial.lines,
    globalDiscountPercent: partial.globalDiscountPercent,
    shippingCost: partial.shippingCost
  });
  const quote: Quote = {
    ...partial,
    id,
    createdAt: createdAt.toISOString(),
    number,
    totals
  };
  await writeJsonFile(path.join(QUOTES_DIR, `${id}.json`), quote);
  return quote;
}

export async function generateNextQuoteNumber(date = new Date()): Promise<string> {
  const prefix = date.toISOString().slice(0, 10).replace(/-/g, '');
  const files = await listFiles(QUOTES_DIR);
  let maxSequence = 0;
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const quote = await readQuoteFile(path.join(QUOTES_DIR, file));
    if (!quote) continue;
    if (!quote.number.startsWith(prefix)) continue;
    const parts = quote.number.split('-');
    const seq = Number(parts[1] ?? 0);
    if (!Number.isNaN(seq)) {
      maxSequence = Math.max(maxSequence, seq);
    }
  }
  return `${prefix}-${String(maxSequence + 1).padStart(3, '0')}`;
}

export async function deleteQuote(id: string): Promise<void> {
  const filePath = path.join(process.cwd(), 'data', QUOTES_DIR, `${id}.json`);
  try {
    await fs.unlink(filePath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

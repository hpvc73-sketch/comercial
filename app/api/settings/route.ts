import { NextResponse } from 'next/server';
import { getSettings, saveSettings, CompanySettings } from '@/lib/settings';

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json(settings);
}

export async function POST(request: Request) {
  const payload = (await request.json()) as Partial<CompanySettings>;
  const settings: CompanySettings = {
    logoUrl: payload.logoUrl ?? '',
    companyName: payload.companyName ?? '',
    address: payload.address ?? '',
    vatNumber: payload.vatNumber ?? '',
    email: payload.email ?? '',
    website: payload.website ?? '',
    phone: payload.phone ?? ''
  };
  await saveSettings(settings);
  return NextResponse.json(settings);
}

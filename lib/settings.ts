import { readJsonFile, writeJsonFile } from './storage';

export type CompanySettings = {
  logoUrl: string;
  companyName: string;
  address: string;
  vatNumber: string;
  email: string;
  website: string;
  phone: string;
};

const DEFAULT_SETTINGS: CompanySettings = {
  logoUrl: '',
  companyName: 'Policópia',
  address: 'Rua Exemplo 123, 1000-000 Lisboa',
  vatNumber: 'PT500000000',
  email: 'contacto@policopia.pt',
  website: 'https://www.policopia.pt',
  phone: '+351 210 000 000'
};

const SETTINGS_PATH = 'settings/settings.json';

export async function getSettings(): Promise<CompanySettings> {
  return readJsonFile<CompanySettings>(SETTINGS_PATH, DEFAULT_SETTINGS);
}

export async function saveSettings(settings: CompanySettings): Promise<void> {
  await writeJsonFile<CompanySettings>(SETTINGS_PATH, settings);
}

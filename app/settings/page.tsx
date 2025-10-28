import { getSettings } from '@/lib/settings';
import { SettingsForm } from '@/components/SettingsForm';

export default async function SettingsPage() {
  const settings = await getSettings();
  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Definições da empresa</h1>
        <p className="text-slate-600">Atualize o logótipo e os contactos que aparecem nos orçamentos.</p>
      </header>
      <SettingsForm initialValues={settings} />
    </section>
  );
}

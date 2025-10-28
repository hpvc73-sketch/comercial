'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { CompanySettings } from '@/lib/settings';
import { createZodResolver } from '@/lib/zodResolver';

const settingsSchema = z.object({
  logoUrl: z.string().url('Insira um URL válido').or(z.literal('')).optional(),
  companyName: z.string().min(1, 'Obrigatório'),
  address: z.string().min(1, 'Obrigatório'),
  vatNumber: z.string().min(1, 'Obrigatório'),
  email: z.string().email('Email inválido'),
  website: z.string().url('URL inválido'),
  phone: z.string().min(1, 'Obrigatório')
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

type SettingsFormProps = {
  initialValues: CompanySettings;
};

export function SettingsForm({ initialValues }: SettingsFormProps) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<SettingsFormValues>({
    defaultValues: initialValues,
    resolver: createZodResolver(settingsSchema)
  });

  const onSubmit = handleSubmit(async (values) => {
    setStatus('saving');
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      });
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (error) {
      console.error(error);
      setStatus('error');
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700" htmlFor="companyName">
            Nome da empresa
          </label>
          <input id="companyName" {...register('companyName')} />
          {errors.companyName && <p className="text-sm text-red-600">{errors.companyName.message}</p>}
        </div>
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700" htmlFor="logoUrl">
            URL do logótipo
          </label>
          <input id="logoUrl" {...register('logoUrl')} placeholder="https://" />
          {errors.logoUrl && <p className="text-sm text-red-600">{errors.logoUrl.message}</p>}
        </div>
        <div className="space-y-2 md:col-span-2">
          <label className="block text-sm font-medium text-slate-700" htmlFor="address">
            Morada
          </label>
          <textarea id="address" rows={2} {...register('address')} />
          {errors.address && <p className="text-sm text-red-600">{errors.address.message}</p>}
        </div>
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700" htmlFor="vatNumber">
            NIF
          </label>
          <input id="vatNumber" {...register('vatNumber')} />
          {errors.vatNumber && <p className="text-sm text-red-600">{errors.vatNumber.message}</p>}
        </div>
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700" htmlFor="email">
            Email
          </label>
          <input id="email" type="email" {...register('email')} />
          {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
        </div>
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700" htmlFor="website">
            Website
          </label>
          <input id="website" {...register('website')} placeholder="https://" />
          {errors.website && <p className="text-sm text-red-600">{errors.website.message}</p>}
        </div>
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700" htmlFor="phone">
            Telefone
          </label>
          <input id="phone" {...register('phone')} />
          {errors.phone && <p className="text-sm text-red-600">{errors.phone.message}</p>}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="bg-primary-500 hover:bg-primary-600 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary-400"
          disabled={status === 'saving'}
        >
          {status === 'saving' ? 'A guardar...' : 'Guardar definições'}
        </button>
        {status === 'saved' && <span className="text-sm text-green-600">Definições guardadas.</span>}
        {status === 'error' && <span className="text-sm text-red-600">Ocorreu um erro ao guardar.</span>}
      </div>
    </form>
  );
}

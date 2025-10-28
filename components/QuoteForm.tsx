'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import type { CompanySettings } from '@/lib/settings';
import { calculateQuoteTotals, DiscountType } from '@/lib/calc';
import { createZodResolver } from '@/lib/zodResolver';
import { QuoteTotals } from '@/components/QuoteTotals';
import { LineItemRow } from '@/components/LineItemRow';
import { formatCurrency, formatDate } from '@/lib/format';

const lineSchema = z.object({
  id: z.string(),
  description: z.string().min(1, 'Obrigatório'),
  quantity: z.number().min(0, 'Qtd ≥ 0'),
  unitPrice: z.number().min(0, 'Preço ≥ 0'),
  taxRate: z.number().min(0, 'IVA ≥ 0'),
  discountType: z.enum(['percent', 'value']),
  discountValue: z.number().min(0, 'Desconto ≥ 0'),
  imageData: z.string().optional()
});

const quoteSchema = z.object({
  id: z.string().optional(),
  number: z.string().min(1, 'Obrigatório'),
  createdAt: z.string().optional(),
  validityDays: z.number().min(1, 'Pelo menos 1 dia'),
  client: z.object({
    name: z.string().min(1, 'Obrigatório'),
    vatNumber: z.string().min(1, 'Obrigatório'),
    email: z.string().email('Email inválido'),
    phone: z.string().min(1, 'Obrigatório'),
    address: z.string().min(1, 'Obrigatório')
  }),
  lines: z.array(lineSchema).min(1, 'Adicione pelo menos uma linha'),
  globalDiscountPercent: z.number().min(0).max(100),
  shippingCost: z.number().min(0),
  notes: z.string().optional()
});

export type QuoteFormLine = z.infer<typeof lineSchema>;
export type QuoteFormValues = z.infer<typeof quoteSchema>;

type QuoteFormProps = {
  mode: 'create' | 'edit';
  initialValues: QuoteFormValues;
  settings: CompanySettings;
};

export function QuoteForm({ mode, initialValues, settings }: QuoteFormProps) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [exporting, setExporting] = useState<'none' | 'pdf' | 'docx'>('none');
  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors }
  } = useForm<QuoteFormValues>({
    defaultValues: initialValues,
    resolver: createZodResolver(quoteSchema)
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'lines'
  });

  useEffect(() => {
    if (fields.length === 0) {
      append(createEmptyLine());
    }
  }, [append, fields.length]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        onSubmit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const values = watch();
  const lines = values.lines ?? [];
  const globalDiscount = values.globalDiscountPercent ?? 0;
  const shippingCost = values.shippingCost ?? 0;

  const totals = useMemo(
    () =>
      calculateQuoteTotals({
        lines: lines.map((line) => ({
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          taxRate: line.taxRate,
          discountType: line.discountType as DiscountType,
          discountValue: line.discountValue
        })),
        globalDiscountPercent: globalDiscount,
        shippingCost
      }),
    [lines, globalDiscount, shippingCost]
  );

  const onSubmit = useCallback(
    () =>
      handleSubmit(async (values) => {
        setStatus('saving');
        const endpoint = mode === 'create' ? '/api/quotes' : `/api/quotes/${values.id}`;
        const method = mode === 'create' ? 'POST' : 'PUT';
        const payload = {
          ...values,
          createdAt: values.createdAt ?? new Date().toISOString()
        };
        try {
          const response = await fetch(endpoint, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!response.ok) {
            throw new Error('Erro ao guardar');
          }
          const saved = (await response.json()) as QuoteFormValues & { totals: unknown };
          setValue('id', saved.id, { shouldDirty: false });
          setValue('number', saved.number, { shouldDirty: false });
          setValue('createdAt', saved.createdAt, { shouldDirty: false });
          setValue('validityDays', saved.validityDays, { shouldDirty: false });
          setValue('client', saved.client, { shouldDirty: false });
          setValue('lines', saved.lines, { shouldDirty: false });
          setValue('globalDiscountPercent', saved.globalDiscountPercent, { shouldDirty: false });
          setValue('shippingCost', saved.shippingCost, { shouldDirty: false });
          setValue('notes', saved.notes ?? '', { shouldDirty: false });
          setStatus('saved');
          setTimeout(() => setStatus('idle'), 2000);
        } catch (error) {
          console.error(error);
          setStatus('error');
        }
      })(),
    [handleSubmit, mode]
  );

  const handleAddLine = () => {
    append(createEmptyLine());
  };

  const handleExportPdf = async () => {
    setExporting('pdf');
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const element = document.getElementById('quote-preview');
      if (!element) return;
      html2pdf()
        .set({
          margin: 10,
          filename: `orcamento-${values.number}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2 },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        })
        .from(element)
        .save();
    } finally {
      setTimeout(() => setExporting('none'), 1000);
    }
  };

  const handleExportDocx = async () => {
    setExporting('docx');
    try {
      const docx = await import('docx');
      const { Document, Packer, Paragraph, Table, TableCell, TableRow, AlignmentType, WidthType } = docx;
      const tableRows = [
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ text: 'Descrição', bold: true })] }),
            new TableCell({ children: [new Paragraph({ text: 'Qtd.', bold: true })] }),
            new TableCell({ children: [new Paragraph({ text: 'Preço Unit.', bold: true })] }),
            new TableCell({ children: [new Paragraph({ text: 'IVA', bold: true })] }),
            new TableCell({ children: [new Paragraph({ text: 'Subtotal', bold: true })] })
          ]
        }),
        ...values.lines.map((line) =>
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph(line.description)] }),
              new TableCell({ children: [new Paragraph(line.quantity.toString())] }),
              new TableCell({ children: [new Paragraph(formatCurrency(line.unitPrice))] }),
              new TableCell({ children: [new Paragraph(`${line.taxRate}%`)] }),
              new TableCell({
                children: [
                  new Paragraph(
                    formatCurrency(
                      (line.quantity * line.unitPrice -
                        (line.discountType === 'percent'
                          ? line.quantity * line.unitPrice * (line.discountValue / 100)
                          : Math.min(line.discountValue, line.quantity * line.unitPrice))) *
                        (1 + line.taxRate / 100)
                    )
                  )
                ]
              })
            ]
          })
        )
      ];

      const doc = new Document({
        sections: [
          {
            children: [
              new Paragraph({
                text: settings.companyName,
                heading: 'Heading1',
                alignment: AlignmentType.LEFT
              }),
              new Paragraph({ text: settings.address }),
              new Paragraph({ text: `NIF: ${settings.vatNumber}` }),
              new Paragraph({ text: `${settings.email} | ${settings.phone}` }),
              new Paragraph({ text: `Website: ${settings.website}` }),
              new Paragraph({ text: '' }),
              new Paragraph({ text: `Orçamento ${values.number}`, heading: 'Heading2' }),
              new Paragraph({ text: `Data: ${formatDate(values.createdAt ?? new Date())}` }),
              new Paragraph({ text: `Validade: ${values.validityDays} dias` }),
              new Paragraph({ text: '' }),
              new Paragraph({ text: 'Cliente', heading: 'Heading3' }),
              new Paragraph({ text: values.client.name }),
              new Paragraph({ text: `NIF: ${values.client.vatNumber}` }),
              new Paragraph({ text: values.client.address }),
              new Paragraph({ text: `${values.client.email} | ${values.client.phone}` }),
              new Paragraph({ text: '' }),
              new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows: tableRows
              }),
              new Paragraph({ text: '' }),
              new Paragraph({ text: `Total com IVA: ${formatCurrency(totals.grandTotal)}`, bold: true }),
              new Paragraph({ text: `Notas: ${values.notes ?? ''}` })
            ]
          }
        ]
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `orcamento-${values.number}.docx`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setTimeout(() => setExporting('none'), 1000);
    }
  };

  return (
    <div className="space-y-8">
      <form className="space-y-6" onSubmit={(event) => event.preventDefault()}>
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700" htmlFor="number">
                    Nº Orçamento
                  </label>
                  <input id="number" {...register('number')} readOnly className="bg-slate-100" />
                  {errors.number && <p className="text-sm text-red-600">{errors.number.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700" htmlFor="validityDays">
                    Validade (dias)
                  </label>
                  <input id="validityDays" type="number" {...register('validityDays', { valueAsNumber: true })} />
                  {errors.validityDays && <p className="text-sm text-red-600">{errors.validityDays.message}</p>}
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Cliente</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600" htmlFor="client.name">
                      Nome
                    </label>
                    <input id="client.name" {...register('client.name')} />
                    {errors.client?.name && <p className="text-sm text-red-600">{errors.client.name.message}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600" htmlFor="client.vatNumber">
                      NIF
                    </label>
                    <input id="client.vatNumber" {...register('client.vatNumber')} />
                    {errors.client?.vatNumber && <p className="text-sm text-red-600">{errors.client.vatNumber.message}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600" htmlFor="client.email">
                      Email
                    </label>
                    <input id="client.email" type="email" {...register('client.email')} />
                    {errors.client?.email && <p className="text-sm text-red-600">{errors.client.email.message}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600" htmlFor="client.phone">
                      Telefone
                    </label>
                    <input id="client.phone" {...register('client.phone')} />
                    {errors.client?.phone && <p className="text-sm text-red-600">{errors.client.phone.message}</p>}
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-slate-600" htmlFor="client.address">
                      Morada
                    </label>
                    <textarea id="client.address" rows={2} {...register('client.address')} />
                    {errors.client?.address && <p className="text-sm text-red-600">{errors.client.address.message}</p>}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-4">
              <header className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-800">Linhas do orçamento</h3>
                <button
                  type="button"
                  onClick={handleAddLine}
                  className="border border-primary-500 text-primary-600 hover:bg-primary-50"
                >
                  Adicionar linha
                </button>
              </header>
              <div className="space-y-4">
                {fields.map((field, index) => (
                  <LineItemRow
                    key={field.id}
                    index={index}
                    register={register}
                    setValue={setValue}
                    watch={watch}
                    remove={remove}
                    errors={errors}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700" htmlFor="globalDiscountPercent">
                    Desconto global (%)
                  </label>
                  <input
                    id="globalDiscountPercent"
                    type="number"
                    step="0.01"
                    {...register('globalDiscountPercent', { valueAsNumber: true })}
                  />
                  {errors.globalDiscountPercent && (
                    <p className="text-sm text-red-600">{errors.globalDiscountPercent.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700" htmlFor="shippingCost">
                    Portes (€)
                  </label>
                  <input id="shippingCost" type="number" step="0.01" {...register('shippingCost', { valueAsNumber: true })} />
                  {errors.shippingCost && <p className="text-sm text-red-600">{errors.shippingCost.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700" htmlFor="notes">
                    Observações
                  </label>
                  <textarea id="notes" rows={3} {...register('notes')} className="min-h-[104px]" />
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <QuoteTotals totals={totals} />
            <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-3">
              <h3 className="text-lg font-semibold text-slate-800">Ações</h3>
              <button
                type="button"
                onClick={onSubmit}
                className="w-full bg-primary-500 hover:bg-primary-600 text-white"
                disabled={status === 'saving'}
              >
                {status === 'saving' ? 'A guardar...' : 'Guardar'} (Ctrl+S)
              </button>
              {status === 'saved' && <p className="text-sm text-green-600">Orçamento guardado.</p>}
              {status === 'error' && <p className="text-sm text-red-600">Ocorreu um erro ao guardar.</p>}
              <button
                type="button"
                onClick={handleExportPdf}
                className="w-full border border-slate-300 hover:bg-slate-100"
                disabled={exporting !== 'none'}
              >
                {exporting === 'pdf' ? 'A gerar PDF...' : 'Exportar PDF'}
              </button>
              <button
                type="button"
                onClick={handleExportDocx}
                className="w-full border border-slate-300 hover:bg-slate-100"
                disabled={exporting !== 'none'}
              >
                {exporting === 'docx' ? 'A gerar DOCX...' : 'Exportar DOCX'}
              </button>
            </div>
          </div>
        </section>
      </form>

      <section id="quote-preview" className="rounded-lg border border-dashed border-slate-300 bg-white p-6 shadow-sm">
        <header className="flex justify-between items-start gap-6 border-b border-slate-200 pb-4 mb-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold text-primary-700">Orçamento #{values.number}</h2>
            <p className="text-sm text-slate-600">Emitido em {formatDate(values.createdAt ?? new Date())}</p>
            <p className="text-sm text-slate-600">Válido por {values.validityDays} dias</p>
          </div>
          {settings.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={settings.logoUrl} alt={settings.companyName} className="h-16 object-contain" />
          )}
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <h3 className="text-sm font-semibold text-slate-700 uppercase">Cliente</h3>
            <p className="text-sm text-slate-600">{values.client.name}</p>
            <p className="text-sm text-slate-600">NIF: {values.client.vatNumber}</p>
            <p className="text-sm text-slate-600">{values.client.address}</p>
            <p className="text-sm text-slate-600">
              {values.client.email} | {values.client.phone}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-700 uppercase">Empresa</h3>
            <p className="text-sm text-slate-600">{settings.companyName}</p>
            <p className="text-sm text-slate-600">NIF: {settings.vatNumber}</p>
            <p className="text-sm text-slate-600">{settings.address}</p>
            <p className="text-sm text-slate-600">
              {settings.email} | {settings.phone}
            </p>
          </div>
        </div>
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead>
            <tr className="text-left text-slate-500 uppercase tracking-wide">
              <th className="pb-3">Descrição</th>
              <th className="pb-3">Qtd.</th>
              <th className="pb-3">Preço Unit.</th>
              <th className="pb-3">IVA</th>
              <th className="pb-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {lines.map((line) => {
              const lineSubtotal = line.quantity * line.unitPrice;
              const lineDiscount =
                line.discountType === 'percent'
                  ? lineSubtotal * (line.discountValue / 100)
                  : Math.min(line.discountValue, lineSubtotal);
              const lineNet = lineSubtotal - lineDiscount;
              const lineTotal = lineNet * (1 + line.taxRate / 100);
              return (
                <tr key={line.id} className="align-top">
                  <td className="py-3">
                    <p className="font-medium text-slate-700">{line.description}</p>
                    {line.imageData && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={line.imageData} alt="Imagem do item" className="mt-2 h-16 rounded border border-slate-200" />
                    )}
                  </td>
                  <td className="py-3">{line.quantity}</td>
                  <td className="py-3">{formatCurrency(line.unitPrice)}</td>
                  <td className="py-3">{line.taxRate}%</td>
                  <td className="py-3 text-right">{formatCurrency(lineTotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-semibold text-slate-700 uppercase">Observações</h4>
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{values.notes}</p>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{formatCurrency(totals.baseTaxable)}</span>
            </div>
            <div className="flex justify-between">
              <span>Desconto global</span>
              <span>- {formatCurrency(totals.globalDiscountAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span>Portes</span>
              <span>{formatCurrency(totals.shippingCost)}</span>
            </div>
            <div>
              <p className="font-medium text-slate-700">IVA</p>
              <ul className="space-y-1">
                {totals.taxBreakdown.map((tax) => (
                  <li key={tax.rate} className="flex justify-between">
                    <span>{tax.rate}%</span>
                    <span>{formatCurrency(tax.tax)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex justify-between text-base font-semibold text-primary-700">
              <span>Total</span>
              <span>{formatCurrency(totals.grandTotal)}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function createEmptyLine(): QuoteFormLine {
  return {
    id: crypto.randomUUID(),
    description: '',
    quantity: 1,
    unitPrice: 0,
    taxRate: 23,
    discountType: 'percent',
    discountValue: 0
  };
}

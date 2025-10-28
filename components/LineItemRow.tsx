'use client';

import { useCallback } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import type {
  FieldErrors,
  UseFormRegister,
  UseFormSetValue,
  UseFormWatch
} from 'react-hook-form';
import type { QuoteFormValues } from '@/components/QuoteForm';
import { formatCurrency } from '@/lib/format';

const discountLabels = {
  percent: '%',
  value: '€'
} as const;

type LineItemRowProps = {
  index: number;
  register: UseFormRegister<QuoteFormValues>;
  setValue: UseFormSetValue<QuoteFormValues>;
  watch: UseFormWatch<QuoteFormValues>;
  remove: (index: number) => void;
  errors: FieldErrors<QuoteFormValues>;
};

type LineFieldErrors = FieldErrors<QuoteFormValues['lines'][number]>;

export function LineItemRow({ index, register, setValue, watch, remove, errors }: LineItemRowProps) {
  const line = watch(`lines.${index}`);
  const lineErrors = Array.isArray(errors.lines) ? (errors.lines[index] as LineFieldErrors | undefined) : undefined;

  const onImageSelect = useCallback(
    (file: File | null) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        setValue(`lines.${index}.imageData`, reader.result as string);
      };
      reader.readAsDataURL(file);
    },
    [index, setValue]
  );

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      onImageSelect(file);
    }
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (file) {
      onImageSelect(file);
    }
  };

  const removeImage = () => {
    setValue(`lines.${index}.imageData`, undefined);
  };

  const subtotal = (line?.quantity ?? 0) * (line?.unitPrice ?? 0);
  const discountAmount =
    line?.discountType === 'percent'
      ? subtotal * ((line?.discountValue ?? 0) / 100)
      : Math.min(line?.discountValue ?? 0, subtotal);
  const net = subtotal - discountAmount;
  const taxAmount = net * ((line?.taxRate ?? 0) / 100);
  const total = net + taxAmount;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-700">Linha {index + 1}</p>
        <button type="button" onClick={() => remove(index)} className="text-sm text-red-600 hover:underline">
          Remover
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-slate-600" htmlFor={`lines.${index}.description`}>
            Descrição
          </label>
          <textarea id={`lines.${index}.description`} rows={2} {...register(`lines.${index}.description` as const)} />
          {lineErrors?.description?.message && (
            <p className="text-sm text-red-600">{lineErrors.description.message as string}</p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600" htmlFor={`lines.${index}.quantity`}>
            Quantidade
          </label>
          <input
            id={`lines.${index}.quantity`}
            type="number"
            step="0.01"
            {...register(`lines.${index}.quantity` as const, { valueAsNumber: true })}
          />
          {lineErrors?.quantity?.message && <p className="text-sm text-red-600">{lineErrors.quantity.message as string}</p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600" htmlFor={`lines.${index}.unitPrice`}>
            Preço unitário
          </label>
          <input
            id={`lines.${index}.unitPrice`}
            type="number"
            step="0.01"
            {...register(`lines.${index}.unitPrice` as const, { valueAsNumber: true })}
          />
          {lineErrors?.unitPrice?.message && <p className="text-sm text-red-600">{lineErrors.unitPrice.message as string}</p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600" htmlFor={`lines.${index}.taxRate`}>
            Taxa IVA (%)
          </label>
          <input
            id={`lines.${index}.taxRate`}
            type="number"
            step="0.01"
            {...register(`lines.${index}.taxRate` as const, { valueAsNumber: true })}
          />
          {lineErrors?.taxRate?.message && <p className="text-sm text-red-600">{lineErrors.taxRate.message as string}</p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600" htmlFor={`lines.${index}.discountType`}>
            Tipo desconto
          </label>
          <select id={`lines.${index}.discountType`} {...register(`lines.${index}.discountType` as const)}>
            <option value="percent">%</option>
            <option value="value">€</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600" htmlFor={`lines.${index}.discountValue`}>
            Desconto ({discountLabels[line?.discountType ?? 'percent']})
          </label>
          <input
            id={`lines.${index}.discountValue`}
            type="number"
            step="0.01"
            {...register(`lines.${index}.discountValue` as const, { valueAsNumber: true })}
          />
          {lineErrors?.discountValue?.message && (
            <p className="text-sm text-red-600">{lineErrors.discountValue.message as string}</p>
          )}
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-slate-600">Imagem (arraste ou selecione)</label>
          <div
            className="flex items-center justify-center rounded border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            <label className="cursor-pointer">
              <input type="file" accept="image/*" className="hidden" onChange={handleFileInput} />
              Arraste uma imagem ou clique para carregar
            </label>
          </div>
          {line?.imageData && (
            <div className="mt-2 flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={line.imageData} alt="Imagem da linha" className="h-16 rounded border border-slate-200" />
              <button type="button" onClick={removeImage} className="text-sm text-red-600 hover:underline">
                Remover imagem
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-6 text-sm text-slate-600">
        <span>Subtotal: {formatCurrency(subtotal)}</span>
        <span>Desconto: {formatCurrency(discountAmount)}</span>
        <span>IVA: {formatCurrency(taxAmount)}</span>
        <span>Total linha: {formatCurrency(total)}</span>
      </div>
    </div>
  );
}

import type { Scenario } from '@/types/scenario';

const STORAGE_KEY = 'flip-scenarios-v1';

export const loadScenarios = (): Scenario[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Scenario[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveScenarios = (scenarios: Scenario[]): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
};

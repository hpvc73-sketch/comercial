import type { EmpresaTaxSettings } from '@/types/scenario';

export const estimateIrc = (lucroTributavel: number, settings: EmpresaTaxSettings): number => {
  if (lucroTributavel <= 0) return 0;

  let irc = 0;
  if (settings.isPme) {
    const firstTier = Math.min(lucroTributavel, 50000);
    irc += firstTier * 0.15;
    irc += Math.max(0, lucroTributavel - 50000) * 0.19;
  } else {
    irc = lucroTributavel * 0.19;
  }

  if (settings.aplicarDerramaMunicipal) {
    irc += (lucroTributavel * settings.derramaMunicipalPercentagem) / 100;
  }

  if (settings.aplicarDerramaEstadual) {
    irc += (lucroTributavel * settings.derramaEstadualPercentagem) / 100;
  }

  return irc;
};

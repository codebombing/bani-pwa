import { defineTheme, Theme } from '@astryxdesign/core/theme';
import { useMemo, type ReactNode } from 'react';

import { defaultThemeSlug, themes } from '../../astryx-themes';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Чёрный или белый текст на акценте — что контрастнее (WCAG). */
function onAccentColor(accent: string): string {
  const l = luminance(accent);
  const contrastWhite = 1.05 / (l + 0.05);
  const contrastBlack = (l + 0.05) / 0.05;
  return contrastBlack >= contrastWhite ? '#000000' : '#FFFFFF';
}

/**
 * Тёплая тёмная палитра всех заведений: полупрозрачные («стеклянные») поверхности поверх
 * размытого фото-фона (body::before в global.css). Значения [светлая, тёмная]; используется тёмная.
 */
const WARM: Record<string, [string, string]> = {
  '--color-background-body': ['#140B07', '#140B07'],
  '--color-background-surface': ['#24160E', '#24160E'],
  '--color-background-card': ['rgba(52,32,20,0.55)', 'rgba(52,32,20,0.55)'],
  '--color-background-popover': ['#2A1A10', '#2A1A10'],
  '--color-background-muted': ['rgba(255,226,198,0.08)', 'rgba(255,226,198,0.08)'],
  '--color-border': ['rgba(255,226,198,0.14)', 'rgba(255,226,198,0.14)'],
  '--color-border-emphasized': ['rgba(255,226,198,0.28)', 'rgba(255,226,198,0.28)'],
  '--color-text-primary': ['#FFF4E8', '#FFF4E8'],
  '--color-text-secondary': ['rgba(255,236,218,0.68)', 'rgba(255,236,218,0.68)'],
  '--color-icon-primary': ['#FFF4E8', '#FFF4E8'],
  '--color-icon-secondary': ['rgba(255,236,218,0.68)', 'rgba(255,236,218,0.68)'],
};

const DEFAULT_ACCENT = '#E0782F';

/** Тема заведения: тёплая тёмная основа + акцент из business.json (на рантайме). */
export function TenantTheme({
  slug,
  accent,
  children,
}: {
  slug: string;
  accent?: string;
  children: ReactNode;
}) {
  const base = themes[defaultThemeSlug];
  const theme = useMemo(() => {
    const a = accent && HEX_RE.test(accent) ? accent : DEFAULT_ACCENT;
    return defineTheme({
      name: `tenant-${slug}`,
      extends: base,
      tokens: {
        ...WARM,
        '--color-accent': [a, a],
        '--color-text-accent': [a, a],
        '--color-on-accent': [onAccentColor(a), onAccentColor(a)],
      },
    });
  }, [base, slug, accent]);

  return (
    <Theme theme={theme} mode="dark">
      {children}
    </Theme>
  );
}

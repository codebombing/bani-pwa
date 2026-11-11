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

/** Тема заведения: базовая тёмная neutral + акцент из business.json (на рантайме). */
export function TenantTheme({ slug, accent, children }: { slug: string; accent?: string; children: ReactNode }) {
  const base = themes[defaultThemeSlug];
  const theme = useMemo(() => {
    if (!accent || !HEX_RE.test(accent)) return base;
    return defineTheme({
      name: `tenant-${slug}`,
      extends: base,
      tokens: {
        '--color-accent': [accent, accent],
        '--color-on-accent': [onAccentColor(accent), onAccentColor(accent)],
      },
    });
  }, [base, slug, accent]);

  return (
    <Theme theme={theme} mode="dark">
      {children}
    </Theme>
  );
}

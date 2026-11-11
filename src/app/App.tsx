import { InternationalizationProvider, type ProviderMessagesByLocale } from '@astryxdesign/core/i18n';
import ruRU from '@astryxdesign/core/locales/ru-RU.json';
import { Theme } from '@astryxdesign/core/theme';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';

import { defaultThemeSlug, themes } from '../astryx-themes';
import { queryClient } from './query-client';
import { router } from './router';

// Встроенные строки Astryx (календарь, «Обязательно», закрытие окон) — по-русски.
const messages = { 'ru-RU': ruRU } as unknown as ProviderMessagesByLocale;

export function App() {
  return (
    <InternationalizationProvider locale="ru-RU" messages={messages}>
      <Theme theme={themes[defaultThemeSlug]} mode="dark">
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </Theme>
    </InternationalizationProvider>
  );
}

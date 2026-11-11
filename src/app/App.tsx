import { Theme } from '@astryxdesign/core/theme';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';

import { defaultThemeSlug, themes } from '../astryx-themes';
import { queryClient } from './query-client';
import { router } from './router';

export function App() {
  return (
    <Theme theme={themes[defaultThemeSlug]} mode="dark">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </Theme>
  );
}

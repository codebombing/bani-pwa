import { createBrowserRouter } from 'react-router';

import { RootLayout } from './RootLayout';
import { DevIndexPage } from './routes/DevIndexPage';
import { NotFoundPage } from './routes/NotFoundPage';
import { RouteErrorPage } from './routes/RouteErrorPage';

/**
 * /s/:slug/*        — гостевое приложение заведения
 * /s/:slug/owner/*  — кабинет владельца
 * /                 — служебный список demo-ссылок (только dev)
 */
export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <DevIndexPage /> },
      // Отдельные чанки: гость не загружает код кабинета, и наоборот.
      {
        path: 's/:slug/owner/*',
        lazy: async () => ({ Component: (await import('../features/owner/OwnerApp')).OwnerApp }),
      },
      {
        path: 's/:slug/*',
        lazy: async () => ({ Component: (await import('../features/booking/GuestApp')).GuestApp }),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

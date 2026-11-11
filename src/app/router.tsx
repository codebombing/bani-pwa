import { createBrowserRouter } from 'react-router';

import { GuestApp } from '../features/booking/GuestApp';
import { OwnerApp } from '../features/owner/OwnerApp';
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
      { path: 's/:slug/owner/*', element: <OwnerApp /> },
      { path: 's/:slug/*', element: <GuestApp /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

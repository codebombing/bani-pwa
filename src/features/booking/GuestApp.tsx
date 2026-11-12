import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { VStack } from '@astryxdesign/core/VStack';
import { useEffect } from 'react';
import { Route, Routes, useParams } from 'react-router';

import { ApiError, errorMessage } from './api';
import { BookingPage } from './BookingPage';
import { useCatalog } from './queries';
import { TenantTheme } from './TenantTheme';
import { VenuePage } from './VenuePage';

/** Гостевое приложение заведения /s/:slug/*. */
export function GuestApp() {
  const { slug = '' } = useParams();
  const catalog = useCatalog(slug);

  useEffect(() => {
    if (catalog.data) document.title = `${catalog.data.tenant.name} — бронирование`;
  }, [catalog.data]);

  if (catalog.isPending) {
    return (
      <VStack as="main" padding={4} gap={4} maxWidth={640}>
        <Skeleton height={36} width="60%" />
        <Skeleton height={20} width="80%" index={1} />
        <Skeleton height={52} index={2} />
        <Skeleton height={160} index={3} />
        <Skeleton height={160} index={4} />
      </VStack>
    );
  }

  if (catalog.isError) {
    const notFound = catalog.error instanceof ApiError && catalog.error.status === 404;
    return (
      <VStack as="main" padding={6} maxWidth={640}>
        {notFound ? (
          <EmptyState
            title="Заведение не найдено"
            description="Проверьте ссылку — возможно, в ней опечатка."
          />
        ) : (
          <Banner
            status="error"
            title="Не удалось загрузить заведение"
            description={errorMessage(catalog.error)}
            endContent={<Button label="Повторить" onClick={() => void catalog.refetch()} />}
          />
        )}
      </VStack>
    );
  }

  return (
    <TenantTheme slug={slug} accent={catalog.data.tenant.theme.accent}>
      <Routes>
        <Route index element={<VenuePage catalog={catalog.data} />} />
        <Route
          path="b/:token"
          element={<BookingPage tenant={catalog.data.tenant} halls={catalog.data.halls} />}
        />
        <Route
          path="*"
          element={
            <VStack as="main" padding={6}>
              <EmptyState
                title="Страница не найдена"
                actions={<Button label="К залам" href={`/s/${slug}/`} />}
              />
            </VStack>
          }
        />
      </Routes>
    </TenantTheme>
  );
}

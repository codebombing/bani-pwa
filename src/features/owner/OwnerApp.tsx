import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { VStack } from '@astryxdesign/core/VStack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { Route, Routes, useParams } from 'react-router';

import { TenantTheme } from '../booking/TenantTheme';
import { signOut, useSession } from './auth';
import { BookingsPage } from './BookingsPage';
import { CalendarPage } from './CalendarPage';
import { LoginPage } from './LoginPage';
import { MorePage } from './MorePage';
import { ownerApi, ownerErrorMessage } from './ownerApi';
import { OwnerContext, type OwnerCtx } from './ownerContext';
import { OwnerShell } from './OwnerShell';
import { StatsPage } from './StatsPage';

function Loading() {
  return (
    <VStack as="main" padding={4} gap={4} maxWidth={640}>
      <Skeleton height={32} width="50%" />
      <Skeleton height={200} index={1} />
      <Skeleton height={200} index={2} />
    </VStack>
  );
}

/** Кабинет владельца /s/:slug/owner/*. Вход по magic link, членство проверяется в БД. */
export function OwnerApp() {
  const { slug = '' } = useParams();
  const session = useSession();
  const queryClient = useQueryClient();
  const userId = session?.user.id ?? null;

  const tenant = useQuery({
    queryKey: ['public', slug, 'owner-tenant'],
    queryFn: () => ownerApi.tenant(slug),
    staleTime: 60_000,
  });
  const tenantId = tenant.data?.id ?? null;

  const access = useQuery({
    queryKey: ['private', 'owner', tenantId, 'access', userId],
    queryFn: async () => {
      if (!tenantId || !userId) throw new Error('нет данных');
      const role = await ownerApi.role(tenantId, userId);
      const halls = role ? await ownerApi.halls(tenantId) : [];
      return { role, halls };
    },
    enabled: tenantId !== null && userId !== null,
  });

  useEffect(() => {
    document.title = `${tenant.data?.name ?? 'Заведение'} — кабинет`;
  }, [tenant.data?.name]);

  const ctx = useMemo<OwnerCtx | null>(() => {
    if (!tenant.data || !access.data?.role || !session) return null;
    return {
      tenant: tenant.data,
      halls: access.data.halls,
      email: session.user.email ?? '',
      role: access.data.role,
    };
  }, [tenant.data, access.data, session]);

  const page = (() => {
    if (session === undefined || tenant.isPending) return <Loading />;
    if (tenant.isError) {
      return (
        <VStack as="main" padding={4} maxWidth={640}>
          <Banner
            status="error"
            title="Не удалось загрузить заведение"
            description={ownerErrorMessage(tenant.error)}
            endContent={<Button label="Повторить" onClick={() => void tenant.refetch()} />}
          />
        </VStack>
      );
    }
    if (!tenant.data) {
      return (
        <VStack as="main" padding={6}>
          <EmptyState title="Заведение не найдено" description="Проверьте адрес кабинета." />
        </VStack>
      );
    }
    if (!session) return <LoginPage slug={slug} tenantName={tenant.data.name} />;
    if (access.isPending) return <Loading />;
    if (access.isError) {
      return (
        <VStack as="main" padding={4} maxWidth={640}>
          <Banner
            status="error"
            title="Не удалось проверить доступ"
            description={ownerErrorMessage(access.error)}
            endContent={<Button label="Повторить" onClick={() => void access.refetch()} />}
          />
        </VStack>
      );
    }
    if (!ctx) {
      return (
        <VStack as="main" padding={6} maxWidth={640}>
          <EmptyState
            title="Нет доступа к этому заведению"
            description={`Вы вошли как ${session.user.email ?? 'пользователь'}, но не состоите в команде «${tenant.data.name}».`}
            actions={<Button label="Выйти" onClick={() => void signOut(queryClient)} />}
          />
        </VStack>
      );
    }
    return (
      <OwnerContext.Provider value={ctx}>
        <OwnerShell>
          <Routes>
            <Route index element={<CalendarPage />} />
            <Route path="bookings" element={<BookingsPage />} />
            <Route path="stats" element={<StatsPage />} />
            <Route path="more" element={<MorePage />} />
            <Route path="*" element={<CalendarPage />} />
          </Routes>
        </OwnerShell>
      </OwnerContext.Provider>
    );
  })();

  return (
    <TenantTheme slug={slug} accent={tenant.data?.theme.accent}>
      {page}
    </TenantTheme>
  );
}

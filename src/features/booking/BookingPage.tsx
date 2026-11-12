import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';

import { formatDateTimeInTz, formatRangeInTz, formatRub } from '../../shared/format';
import { PushToggle } from '../../shared/PushToggle';
import {
  ApiError,
  bookingIcsUrl,
  errorMessage,
  publicApi,
  type Booking,
  type Hall,
  type Tenant,
} from './api';
import { rememberBooking } from './myBookings';
import { PriceLines } from './PriceLines';
import { RescheduleSheet } from './RescheduleSheet';
import { bookingKeys, useBooking } from './queries';

const STATUS: Record<
  Booking['status'],
  { title: string; variant: 'success' | 'warning' | 'error' | 'neutral' }
> = {
  pending: { title: 'Бронь ожидает подтверждения', variant: 'warning' },
  confirmed: { title: 'Бронь подтверждена', variant: 'success' },
  completed: { title: 'Визит состоялся', variant: 'neutral' },
  cancelled: { title: 'Бронь отменена', variant: 'error' },
  no_show: { title: 'Визит не состоялся', variant: 'neutral' },
};

export function BookingPage({ tenant, halls }: { tenant: Tenant; halls: Hall[] }) {
  const { token = '' } = useParams();
  const booking = useBooking(tenant.slug, token);
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [moving, setMoving] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const cancel = useMutation({
    mutationFn: () => publicApi.cancel(tenant.slug, token),
    onSuccess: (data) => {
      queryClient.setQueryData(bookingKeys.booking(tenant.slug, token), data);
      void queryClient.invalidateQueries({ queryKey: bookingKeys.availability(tenant.slug) });
      setConfirmCancel(false);
    },
  });

  const data = booking.data;
  useEffect(() => {
    if (!data) return;
    rememberBooking(tenant.slug, { token, start_at: data.start_at, hall_name: data.hall_name });
    headingRef.current?.focus();
  }, [data, tenant.slug, token]);

  if (booking.isPending) {
    return (
      <VStack as="main" padding={4} gap={4} maxWidth={640}>
        <Skeleton height={36} width="70%" />
        <Skeleton height={160} index={1} />
        <Skeleton height={120} index={2} />
      </VStack>
    );
  }

  if (booking.isError) {
    const notFound = booking.error instanceof ApiError && booking.error.status === 404;
    return (
      <VStack as="main" padding={4} gap={4} maxWidth={640}>
        {notFound ? (
          <EmptyState
            title="Бронь не найдена"
            description="Проверьте ссылку из сообщения. Если бронь создавали по телефону — позвоните в заведение."
            actions={<Button label="К залам" href={`/s/${tenant.slug}/`} />}
          />
        ) : (
          <Banner
            status="error"
            title="Не удалось загрузить бронь"
            description={errorMessage(booking.error)}
            endContent={<Button label="Повторить" onClick={() => void booking.refetch()} />}
          />
        )}
      </VStack>
    );
  }

  const b = booking.data;
  const status = STATUS[b.status];
  const isActive = b.status === 'confirmed' || b.status === 'pending';
  const canCancel = isActive && new Date(b.start_at) > new Date();
  const freeUntil = new Date(b.free_cancellation_until);
  const freeCancel = new Date() <= freeUntil;
  const left = Math.max(0, b.total_amount - b.paid_amount);

  return (
    <VStack as="main" padding={4} gap={6} maxWidth={640}>
      <Button variant="ghost" size="sm" label={`← ${tenant.name}`} href={`/s/${tenant.slug}/`} />
      {b.is_demo && (
        <Banner
          status="info"
          title="Демо-бронь"
          description="Тестовые данные заведения в демо-режиме."
        />
      )}

      <VStack gap={2}>
        <HStack gap={2} vAlign="center">
          <StatusDot variant={status.variant} label={status.title} />
          <Text color="secondary">{tenant.name}</Text>
        </HStack>
        <Heading level={1} ref={headingRef} tabIndex={-1}>
          {status.title}
        </Heading>
        <Text>{formatRangeInTz(b.start_at, b.end_at, b.timezone)}</Text>
      </VStack>

      <MetadataList>
        <MetadataListItem label="Зал">{b.hall_name}</MetadataListItem>
        <MetadataListItem label="Гостей">{String(b.guests)}</MetadataListItem>
        <MetadataListItem label="На имя">{b.customer_name}</MetadataListItem>
        {b.comment && <MetadataListItem label="Комментарий">{b.comment}</MetadataListItem>}
      </MetadataList>

      <VStack gap={3}>
        <Heading level={2}>Стоимость</Heading>
        <PriceLines snapshot={b.price_snapshot} total={b.total_amount} deposit={b.deposit_amount} />
        <Text color="secondary">
          {b.paid_amount > 0
            ? `Оплачено ${formatRub(b.paid_amount)}, осталось ${formatRub(left)}.`
            : `Задаток вносится по договорённости с заведением.`}
        </Text>
      </VStack>

      {cancel.isError && (
        <Banner
          status="error"
          title="Не удалось отменить"
          description={errorMessage(cancel.error)}
        />
      )}

      {canCancel && (
        <VStack gap={2}>
          <Text color="secondary">
            {freeCancel
              ? `Бесплатная отмена до ${formatDateTimeInTz(b.free_cancellation_until, b.timezone)}.`
              : 'Срок бесплатной отмены прошёл: задаток может не вернуться.'}
          </Text>
          {halls.some((h) => h.id === b.hall_id) && (
            <Button variant="secondary" label="Перенести" onClick={() => setMoving(true)} />
          )}
          <Button
            variant="destructive"
            label="Отменить бронь"
            onClick={() => setConfirmCancel(true)}
          />
        </VStack>
      )}

      {canCancel && (
        <PushToggle
          slug={tenant.slug}
          label="Напоминать о брони"
          description="Пришлём напоминание за сутки и за 2 часа, а также сообщим о переносе или отмене."
          save={(sub) => publicApi.pushSubscribe(tenant.slug, token, sub)}
        />
      )}

      {b.status !== 'cancelled' &&
        b.status !== 'completed' &&
        bookingIcsUrl(tenant.slug, token) && (
          <VStack gap={1}>
            <Link href={bookingIcsUrl(tenant.slug, token) ?? undefined}>Добавить в календарь</Link>
            <Text color="secondary">
              Откроется файл события — проверьте, что оно появилось в приложении «Календарь».
            </Text>
          </VStack>
        )}

      <VStack gap={2}>
        {tenant.contacts.phone && (
          <Link href={`tel:${tenant.contacts.phone.replace(/[^+\d]/g, '')}`}>
            {`Позвонить: ${tenant.contacts.phone}`}
          </Link>
        )}
        <Button
          variant={b.status === 'cancelled' || b.status === 'completed' ? 'primary' : 'secondary'}
          size="lg"
          width="100%"
          label={b.status === 'cancelled' ? 'Выбрать другое время' : 'На главную'}
          href={`/s/${tenant.slug}/`}
        />
        <Text color="secondary">
          Сохраните эту страницу — по ссылке бронь можно открыть с любого устройства.
        </Text>
      </VStack>

      {moving && halls.find((h) => h.id === b.hall_id) && (
        <RescheduleSheet
          slug={tenant.slug}
          token={token}
          booking={b}
          hall={halls.find((h) => h.id === b.hall_id) as Hall}
          onClose={() => setMoving(false)}
        />
      )}

      <AlertDialog
        isOpen={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Отменить бронь?"
        description={
          freeCancel
            ? 'Время освободится для других гостей.'
            : 'Срок бесплатной отмены прошёл — задаток может не вернуться.'
        }
        actionLabel="Отменить бронь"
        cancelLabel="Не отменять"
        isActionLoading={cancel.isPending}
        onAction={() => cancel.mutate()}
      />
    </VStack>
  );
}

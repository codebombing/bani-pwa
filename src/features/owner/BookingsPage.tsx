import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Item } from '@astryxdesign/core/Item';
import { List } from '@astryxdesign/core/List';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { dateInTz, formatDateLong, formatRub, formatTimeInTz } from '../../shared/format';
import { OwnerBookingSheet } from './OwnerBookingSheet';
import { ownerApi, ownerErrorMessage, paidAmount, type OwnerBooking } from './ownerApi';
import { ownerKey, useOwner } from './ownerContext';
import { guestsLabel, STATUS_LABEL, STATUS_VARIANT } from './labels';

type Filter = 'upcoming' | 'past' | 'cancelled';
const DAY = 86_400_000;

/** Список броней: предстоящие, прошедшие, отменённые — по дням. */
export function BookingsPage() {
  const { tenant, halls } = useOwner();
  const tz = tenant.timezone;
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ownerKey(tenant.id, 'list', filter),
    queryFn: async () => {
      const now = Date.now();
      if (filter === 'upcoming') {
        return ownerApi.bookings(
          tenant.id,
          new Date(now - 6 * 3_600_000),
          new Date(now + 120 * DAY),
        );
      }
      if (filter === 'past') {
        return ownerApi.bookings(tenant.id, new Date(now - 90 * DAY), new Date(now), {
          ascending: false,
        });
      }
      const all = await ownerApi.bookings(
        tenant.id,
        new Date(now - 90 * DAY),
        new Date(now + 120 * DAY),
        {
          includeCancelled: true,
          ascending: false,
        },
      );
      return all.filter((b) => b.status === 'cancelled');
    },
  });

  const groups = useMemo(() => {
    const map = new Map<string, OwnerBooking[]>();
    for (const b of list.data ?? []) {
      const day = dateInTz(b.start_at, tz);
      map.set(day, [...(map.get(day) ?? []), b]);
    }
    return [...map.entries()];
  }, [list.data, tz]);

  const opened = list.data?.find((b) => b.id === openId) ?? null;
  const hallName = (id: string) => halls.find((h) => h.id === id)?.name ?? 'Зал';

  return (
    <VStack as="main" padding={4} gap={4} maxWidth={720}>
      <Heading level={1}>Брони</Heading>
      <SegmentedControl
        label="Какие брони показать"
        layout="fill"
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
      >
        <SegmentedControlItem value="upcoming" label="Предстоящие" />
        <SegmentedControlItem value="past" label="Прошедшие" />
        <SegmentedControlItem value="cancelled" label="Отменённые" />
      </SegmentedControl>

      {list.isPending && (
        <VStack gap={2}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={56} index={i} />
          ))}
        </VStack>
      )}
      {list.isError && (
        <Banner
          status="error"
          title="Не удалось загрузить брони"
          description={ownerErrorMessage(list.error)}
          endContent={<Button label="Повторить" onClick={() => void list.refetch()} />}
        />
      )}
      {list.isSuccess && groups.length === 0 && (
        <EmptyState
          title={
            filter === 'upcoming'
              ? 'Предстоящих броней нет'
              : filter === 'past'
                ? 'За 90 дней броней нет'
                : 'Отменённых броней нет'
          }
          description={
            filter === 'upcoming' ? 'Новые брони появятся здесь и в календаре.' : undefined
          }
        />
      )}
      {groups.map(([day, items]) => (
        <VStack key={day} gap={1}>
          <Text weight="semibold">{formatDateLong(day)}</Text>
          <List hasDividers>
            {items.map((b) => {
              const paid = paidAmount(b);
              return (
                <Item
                  key={b.id}
                  label={`${formatTimeInTz(b.start_at, tz)}–${formatTimeInTz(b.end_at, tz)} · ${b.customer_name}`}
                  description={`${hallName(b.hall_id)} · ${guestsLabel(b.guests)} · ${formatRub(b.total_amount)}${
                    paid > 0 ? ` · оплачено ${formatRub(paid)}` : ''
                  }`}
                  startContent={
                    <StatusDot variant={STATUS_VARIANT[b.status]} label={STATUS_LABEL[b.status]} />
                  }
                  endContent={<Text color="secondary">{STATUS_LABEL[b.status]}</Text>}
                  onClick={() => setOpenId(b.id)}
                />
              );
            })}
          </List>
        </VStack>
      ))}

      {opened && (
        <OwnerBookingSheet
          booking={opened}
          hallName={hallName(opened.hall_id)}
          onClose={() => setOpenId(null)}
        />
      )}
    </VStack>
  );
}

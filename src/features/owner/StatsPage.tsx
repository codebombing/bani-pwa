import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { addDays, formatDayMonth, formatRub, todayInTz } from '../../shared/format';
import { ownerApi, ownerErrorMessage } from './ownerApi';
import { ownerKey, useOwner } from './ownerContext';

type Period = 'today' | 'week' | 'month' | 'ahead';

function periodRange(period: Period, today: string): [string, string] {
  switch (period) {
    case 'today':
      return [today, today];
    case 'week':
      return [addDays(today, -6), today];
    case 'month': {
      const first = `${today.slice(0, 8)}01`;
      return [first, addDays(addDays(first, 32).slice(0, 8) + '01', -1)];
    }
    case 'ahead':
      return [today, addDays(today, 30)];
  }
}

/** Статистика из owner_stats (SQL): те же цифры и период, что получит AI. */
export function StatsPage() {
  const { tenant } = useOwner();
  const [period, setPeriod] = useState<Period>('month');
  const today = todayInTz(tenant.timezone);
  const [from, to] = periodRange(period, today);

  const stats = useQuery({
    queryKey: ownerKey(tenant.id, 'stats', from, to),
    queryFn: () => ownerApi.stats(tenant.id, from, to),
  });

  return (
    <VStack as="main" padding={4} gap={4} maxWidth={720}>
      <Heading level={1}>Отчёт</Heading>
      <SegmentedControl label="Период" layout="fill" value={period} onChange={(v) => setPeriod(v as Period)}>
        <SegmentedControlItem value="today" label="День" />
        <SegmentedControlItem value="week" label="7 дней" />
        <SegmentedControlItem value="month" label="Месяц" />
        <SegmentedControlItem value="ahead" label="Вперёд" />
      </SegmentedControl>
      <Text color="secondary">{`${formatDayMonth(from)} — ${formatDayMonth(to)}, время ${tenant.timezone}`}</Text>

      {stats.isPending && <Skeleton height={260} />}
      {stats.isError && (
        <Banner
          status="error"
          title="Не удалось посчитать"
          description={ownerErrorMessage(stats.error)}
          endContent={<Button label="Повторить" onClick={() => void stats.refetch()} />}
        />
      )}
      {stats.data && (
        <VStack gap={4}>
          <Card padding={4}>
            <MetadataList title="Деньги">
              <MetadataListItem label="Получено">
                {`${formatRub(stats.data.money_received)} (задатки ${formatRub(stats.data.deposits_received)}${
                  stats.data.refunds > 0 ? `, возвраты ${formatRub(stats.data.refunds)}` : ''
                })`}
              </MetadataListItem>
              <MetadataListItem label="Ожидается">
                {`${formatRub(stats.data.expected_amount)} по ${stats.data.expected_bookings} будущим броням`}
              </MetadataListItem>
            </MetadataList>
            <Text color="secondary">
              «Ожидается» — стоимость будущих броней минус уже полученное по ним. Это ещё не выручка.
            </Text>
          </Card>
          <Card padding={4}>
            <MetadataList title="Брони и визиты">
              <MetadataListItem label="Брони созданы">{String(stats.data.bookings_created)}</MetadataListItem>
              <MetadataListItem label="Визиты состоялись">
                {`${stats.data.visits_completed} на ${formatRub(stats.data.visits_amount)}`}
              </MetadataListItem>
              <MetadataListItem label="Отмены / не пришли">
                {`${stats.data.cancellations} / ${stats.data.no_shows}`}
              </MetadataListItem>
            </MetadataList>
          </Card>
          <Card padding={4}>
            <MetadataList title="Загрузка залов">
              <MetadataListItem label="Всего">
                {`${stats.data.occupancy_pct} % (${stats.data.occupied_hours} из ${stats.data.available_hours} ч)`}
              </MetadataListItem>
              {stats.data.by_hall.map((h) => (
                <MetadataListItem key={h.hall_id} label={h.hall_name}>
                  {`${h.occupancy_pct} % (${h.occupied_hours} ч)`}
                </MetadataListItem>
              ))}
            </MetadataList>
          </Card>
        </VStack>
      )}
    </VStack>
  );
}

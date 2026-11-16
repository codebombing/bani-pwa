import { Divider } from '@astryxdesign/core/Divider';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

import { formatDuration, formatRub } from '../../shared/format';
import type { Snapshot } from './api';

const DAY_TYPE: Record<string, string> = {
  weekday: 'будни',
  weekend: 'выходные',
  holiday: 'праздник',
};

function Row({ label, amount, strong }: { label: string; amount: number; strong?: boolean }) {
  return (
    <HStack justify="between" vAlign="start" gap={3}>
      <Text color={strong ? 'primary' : 'secondary'} weight={strong ? 'semibold' : 'normal'}>
        {label}
      </Text>
      <Text weight={strong ? 'semibold' : 'normal'} hasTabularNumbers>
        {formatRub(amount)}
      </Text>
    </HStack>
  );
}

/** Строки расчёта из серверного снимка цены: аренда по тарифам, доп. гости, допы, итог. */
export function PriceLines({
  snapshot,
  total,
}: {
  snapshot: Snapshot;
  total: number;
}) {
  return (
    <VStack gap={2}>
      {snapshot.rent.map((line) => (
        <Row
          key={line.from}
          label={`${line.from.slice(11)}–${line.to.slice(11)}, ${DAY_TYPE[line.day_type] ?? line.day_type}: ${formatDuration(line.minutes)} × ${formatRub(line.price_per_hour)}`}
          amount={line.amount}
        />
      ))}
      {snapshot.extra_guests && snapshot.extra_guests.amount > 0 && (
        <Row
          label={`Доп. гости: ${snapshot.extra_guests.count}`}
          amount={snapshot.extra_guests.amount}
        />
      )}
      {snapshot.extras.map((e) => (
        <Row key={e.name} label={`${e.name}${e.qty > 1 ? ` × ${e.qty}` : ''}`} amount={e.amount} />
      ))}
      {snapshot.manual_price && <Text color="secondary">Цена согласована с заведением.</Text>}
      <Divider />
      <Row label="Итого" amount={total} strong />
    </VStack>
  );
}

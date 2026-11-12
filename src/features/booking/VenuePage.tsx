import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Item } from '@astryxdesign/core/Item';
import { Link } from '@astryxdesign/core/Link';
import { List } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useState } from 'react';

import { formatDateTimeInTz, formatDuration, formatRub } from '../../shared/format';
import type { Catalog } from './api';
import { BookingFlow } from './BookingFlow';
import { readMyBookings } from './myBookings';

interface FlowStart {
  key: number;
  hallId?: string;
}

export function VenuePage({ catalog }: { catalog: Catalog }) {
  const { tenant, halls } = catalog;
  const [flow, setFlow] = useState<FlowStart | null>(null);
  const myBookings = readMyBookings(tenant.slug);
  const start = (hallId?: string) => setFlow({ key: Date.now(), hallId });

  return (
    <VStack as="main" padding={4} gap={6} maxWidth={640}>
      {tenant.status === 'preview' && (
        <Banner
          status="info"
          title="Демо-режим"
          description="Брони тестовые: уведомления не отправляются, данные помечены как демо."
        />
      )}

      <VStack gap={2}>
        <Heading level={1}>{tenant.name}</Heading>
        {tenant.texts.tagline && <Text color="secondary">{tenant.texts.tagline}</Text>}
        {tenant.contacts.address && <Text color="secondary">{tenant.contacts.address}</Text>}
      </VStack>

      <Button
        variant="primary"
        size="lg"
        label="Забронировать"
        width="100%"
        onClick={() => start()}
      />

      {tenant.texts.description && <Text>{tenant.texts.description}</Text>}

      <VStack gap={3}>
        <Heading level={2}>Залы</Heading>
        {halls.map((hall) => (
          <Card key={hall.id} padding={4}>
            <VStack gap={2}>
              <Heading level={3}>{hall.name}</Heading>
              {hall.description && <Text color="secondary">{hall.description}</Text>}
              <Text>
                {`До ${hall.capacity_max} гостей, ${hall.capacity_included} включено в цену · от ${formatDuration(hall.min_duration_min)}`}
              </Text>
              {hall.extra_guest_price > 0 && (
                <Text color="secondary">
                  {`Сверх ${hall.capacity_included} гостей — ${formatRub(hall.extra_guest_price)} за человека${hall.extra_guest_unit === 'per_hour' ? ' в час' : ''}`}
                </Text>
              )}
              <Button
                variant="secondary"
                label={`Выбрать «${hall.name}»`}
                onClick={() => start(hall.id)}
              />
            </VStack>
          </Card>
        ))}
      </VStack>

      {myBookings.length > 0 && (
        <VStack gap={2}>
          <Heading level={2}>Мои брони</Heading>
          <List hasDividers>
            {myBookings.map((b) => (
              <Item
                key={b.token}
                label={b.hall_name}
                description={formatDateTimeInTz(b.start_at, tenant.timezone)}
                href={`/s/${tenant.slug}/b/${b.token}`}
              />
            ))}
          </List>
        </VStack>
      )}

      <VStack gap={2}>
        <Heading level={2}>Контакты</Heading>
        {tenant.contacts.phone && (
          <Link href={`tel:${tenant.contacts.phone.replace(/[^+\d]/g, '')}`}>
            {tenant.contacts.phone}
          </Link>
        )}
        {tenant.contacts.telegram && (
          <Link href={`https://t.me/${tenant.contacts.telegram}`} isExternalLink>
            {`Telegram: @${tenant.contacts.telegram}`}
          </Link>
        )}
        <Text color="secondary">
          {`Задаток ${tenant.deposit_percent} %. Бесплатная отмена — за ${tenant.free_cancellation_hours} ч до начала.`}
        </Text>
      </VStack>

      {flow && (
        <BookingFlow
          key={flow.key}
          catalog={catalog}
          initialHallId={flow.hallId}
          onClosed={() => setFlow(null)}
        />
      )}
    </VStack>
  );
}

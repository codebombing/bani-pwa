import { AspectRatio } from '@astryxdesign/core/AspectRatio';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Item } from '@astryxdesign/core/Item';
import { Link } from '@astryxdesign/core/Link';
import { List } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useState } from 'react';
import { useLocation } from 'react-router';

import { formatDateTimeInTz, formatDuration, formatRub } from '../../shared/format';
import { assetUrl, type Catalog } from './api';
import { BookingFlow } from './BookingFlow';
import { Wordmark } from './Wordmark';
import { readMyBookings } from './myBookings';

interface FlowStart {
  key: number;
  hallId?: string;
}

export function VenuePage({ catalog }: { catalog: Catalog }) {
  const { tenant, halls } = catalog;
  const myBookings = readMyBookings(tenant.slug);
  const heroUrl = tenant.theme.hero ? assetUrl(tenant, tenant.theme.hero) : null;

  // «Записаться» из чата помощника: navigate(…, { state: { book } }) открывает бронь
  // (GuestApp пересоздаёт страницу по state.book).
  const bookRequest = (useLocation().state as { book?: number } | null)?.book;
  const [flow, setFlow] = useState<FlowStart | null>(() => (bookRequest ? { key: 0 } : null));
  const start = (hallId?: string) => setFlow({ key: Date.now(), hallId });

  return (
    <VStack as="main" padding={4} gap={6} maxWidth={640}>
      <VStack
        gap={2}
        padding={4}
        style={{
          borderRadius: 'var(--radius-lg, 20px)',
          overflow: 'hidden',
          paddingTop: 'var(--spacing-6, 24px)',
          background: `linear-gradient(180deg, rgb(20 11 7 / 0.35) 0%, rgb(20 11 7 / 0.7) 45%, rgb(20 11 7 / 0.92) 100%), url('${heroUrl ?? '/bg/guest.jpg'}') center / cover no-repeat`,
        }}
      >
        <Heading level={1}>
          <Wordmark name={tenant.name} wordmark={tenant.theme.wordmark} />
        </Heading>
        {tenant.texts.tagline && (
          <Text size="lg" weight="semibold">
            {tenant.texts.tagline}
          </Text>
        )}
        {tenant.texts.description && <Text>{tenant.texts.description}</Text>}
        <Text color="secondary">
          {[tenant.contacts.address, tenant.status === 'preview' ? 'демо-режим' : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <Button
          variant="secondary"
          size="lg"
          label="Забронировать"
          width="100%"
          onClick={() => start()}
        />
      </VStack>

      <VStack gap={3}>
        <Heading level={2}>Залы</Heading>
        {halls.map((hall) => (
          <Card key={hall.id} padding={0}>
            {hall.photos[0] && assetUrl(tenant, hall.photos[0]) && (
              <AspectRatio
                ratio={16 / 10}
                fit="cover"
                style={{ borderRadius: 'var(--radius-lg, 16px) var(--radius-lg, 16px) 0 0' }}
              >
                <img
                  src={assetUrl(tenant, hall.photos[0]) ?? undefined}
                  alt={`Зал «${hall.name}»`}
                  width={1280}
                  height={800}
                  loading="lazy"
                  decoding="async"
                />
              </AspectRatio>
            )}
            <VStack gap={2} padding={4}>
              <HStack gap={2} justify="between" vAlign="center">
                <Heading level={3}>{hall.name}</Heading>
                {hall.price_from !== null && (
                  <Text
                    weight="semibold"
                    color="accent"
                  >{`от ${formatRub(hall.price_from)}/ч`}</Text>
                )}
              </HStack>
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

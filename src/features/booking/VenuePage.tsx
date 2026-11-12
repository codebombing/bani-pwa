import { AspectRatio } from '@astryxdesign/core/AspectRatio';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Item } from '@astryxdesign/core/Item';
import { Link } from '@astryxdesign/core/Link';
import { List } from '@astryxdesign/core/List';
import { Overlay } from '@astryxdesign/core/Overlay';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import { formatDateTimeInTz, formatDuration, formatRub } from '../../shared/format';
import { assetUrl, type Catalog } from './api';
import { BookingFlow } from './BookingFlow';
import { readMyBookings } from './myBookings';

interface FlowStart {
  key: number;
  hallId?: string;
}

export function VenuePage({ catalog }: { catalog: Catalog }) {
  const { tenant, halls } = catalog;
  const myBookings = readMyBookings(tenant.slug);
  const heroUrl = tenant.theme.hero ? assetUrl(tenant, tenant.theme.hero) : null;
  const logoUrl = tenant.theme.logo ? assetUrl(tenant, tenant.theme.logo) : null;

  // «Забронировать» из чата помощника: /s/<slug>/?book=1 открывает бронь
  // (GuestApp пересоздаёт страницу по query, поэтому начальное состояние читается здесь).
  const [params, setParams] = useSearchParams();
  const [flow, setFlow] = useState<FlowStart | null>(() =>
    params.get('book') === '1' ? { key: 0 } : null,
  );
  const start = (hallId?: string) => setFlow({ key: Date.now(), hallId });
  useEffect(() => {
    if (params.get('book') === '1') setParams({}, { replace: true });
  }, [params, setParams]);

  return (
    <VStack as="main" padding={4} gap={6} maxWidth={640}>
      <Overlay
        position="bottom"
        align="start"
        content={
          <VStack gap={2} padding={1}>
            {logoUrl && <img src={logoUrl} alt="" width={48} height={48} />}
            <Heading level={1}>{tenant.name}</Heading>
            {tenant.texts.tagline && <Text>{tenant.texts.tagline}</Text>}
            <Text color="secondary">
              {[tenant.contacts.address, tenant.status === 'preview' ? 'демо-режим' : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            <Button
              variant="primary"
              size="lg"
              label="Забронировать"
              width="100%"
              onClick={() => start()}
            />
          </VStack>
        }
      >
        <AspectRatio ratio={4 / 5} fit="cover" style={{ borderRadius: 'var(--radius-lg, 20px)' }}>
          {heroUrl ? (
            <img src={heroUrl} alt="" width={1080} height={1350} fetchPriority="high" />
          ) : (
            <img src="/bg/guest.jpg" alt="" width={720} height={1280} />
          )}
        </AspectRatio>
      </Overlay>

      {tenant.texts.description && <Text>{tenant.texts.description}</Text>}

      <VStack gap={3}>
        <Heading level={2}>Залы</Heading>
        {halls.map((hall) => (
          <Card key={hall.id} padding={4}>
            <VStack gap={2}>
              {hall.photos[0] && assetUrl(tenant, hall.photos[0]) && (
                <AspectRatio ratio={16 / 10} fit="cover">
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

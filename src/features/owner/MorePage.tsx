import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Calendar, type ISODateString } from '@astryxdesign/core/Calendar';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Item } from '@astryxdesign/core/Item';
import { Link } from '@astryxdesign/core/Link';
import { List } from '@astryxdesign/core/List';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Selector } from '@astryxdesign/core/Selector';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { addDays, formatRangeInTz, todayInTz, zonedTimeToUtc } from '../../shared/format';
import { signOut } from './auth';
import { ownerApi, ownerErrorMessage } from './ownerApi';
import { ownerKey, refreshOwnerData, useOwner } from './ownerContext';

const TIMES = Array.from({ length: 49 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  return `${h}:${i % 2 ? '30' : '00'}`;
});

/** «Ещё»: блокировка зала, активные блокировки, ссылка для гостей, выход. */
export function MorePage() {
  const { tenant, halls, email, role } = useOwner();
  const tz = tenant.timezone;
  const queryClient = useQueryClient();
  const today = todayInTz(tz);

  const [hallId, setHallId] = useState(halls[0]?.id ?? '');
  const [date, setDate] = useState(today);
  const [from, setFrom] = useState('10:00');
  const [to, setTo] = useState('14:00');
  const [reason, setReason] = useState('Уборка');

  const fromDate = zonedTimeToUtc(date, from, tz);
  const toDate = to === '24:00' ? zonedTimeToUtc(addDays(date, 1), '00:00', tz) : zonedTimeToUtc(date, to, tz);
  const rangeError = toDate <= fromDate ? 'Конец должен быть позже начала' : null;

  const blocks = useQuery({
    queryKey: ownerKey(tenant.id, 'blocks-upcoming'),
    queryFn: () => ownerApi.blocks(tenant.id, new Date(), new Date(Date.now() + 90 * 86_400_000)),
  });
  const refresh = () => refreshOwnerData(queryClient, tenant.id);
  const block = useMutation({
    mutationFn: () => ownerApi.blockHall(tenant.id, hallId, fromDate, toDate, reason.trim()),
    onSuccess: () => void refresh(),
  });
  const unblock = useMutation({
    mutationFn: (blockId: string) => ownerApi.unblock(blockId),
    onSuccess: () => void refresh(),
  });
  const logout = useMutation({ mutationFn: () => signOut(queryClient) });

  return (
    <VStack as="main" padding={4} gap={6} maxWidth={720}>
      <Heading level={1}>Ещё</Heading>

      <Card padding={4}>
        <VStack gap={3}>
          <Heading level={2}>Закрыть зал</Heading>
          <Text color="secondary">Уборка, ремонт, своё мероприятие — гости не смогут забронировать это время.</Text>
          <Selector
            label="Зал"
            value={hallId}
            options={halls.map((h) => ({ value: h.id, label: h.name }))}
            onChange={setHallId}
          />
          <Calendar
            mode="single"
            value={date as ISODateString}
            min={today as ISODateString}
            weekStartsOn="mon"
            hasVariableRowCount
            onChange={(v: unknown) => {
              if (typeof v === 'string') setDate(v);
            }}
          />
          <HStack gap={3}>
            <Selector label="С" value={from} options={TIMES.slice(0, -1)} onChange={setFrom} />
            <Selector label="До" value={to} options={TIMES.slice(1)} onChange={setTo} />
          </HStack>
          <TextInput label="Причина" value={reason} isRequired onChange={setReason} />
          {rangeError && <Text color="secondary">{rangeError}</Text>}
          {block.isError && (
            <Banner status="error" title="Не удалось закрыть" description={ownerErrorMessage(block.error)} />
          )}
          {block.isSuccess && <Banner status="success" title="Зал закрыт" description={`${from}–${to}, ${reason}`} />}
          <Button
            variant="primary"
            label="Закрыть зал на это время"
            isLoading={block.isPending}
            isDisabled={!hallId || !!rangeError || reason.trim() === ''}
            onClick={() => block.mutate()}
          />
        </VStack>
      </Card>

      <VStack gap={2}>
        <Heading level={2}>Закрытые периоды</Heading>
        {blocks.isPending && <Skeleton height={56} />}
        {blocks.isError && (
          <Banner status="error" title="Не удалось загрузить" description={ownerErrorMessage(blocks.error)} />
        )}
        {blocks.isSuccess && blocks.data.length === 0 && <Text color="secondary">Ближайшие 90 дней всё открыто.</Text>}
        {blocks.isSuccess && blocks.data.length > 0 && (
          <List hasDividers>
            {blocks.data.map((bl) => (
              <Item
                key={bl.occupancyId}
                label={`${halls.find((h) => h.id === bl.hallId)?.name ?? 'Зал'} · ${bl.reason}`}
                description={formatRangeInTz(bl.from, bl.to, tz)}
                endContent={
                  <Button
                    size="sm"
                    variant="secondary"
                    label="Открыть"
                    isLoading={unblock.isPending && unblock.variables === bl.blockId}
                    onClick={() => unblock.mutate(bl.blockId)}
                  />
                }
              />
            ))}
          </List>
        )}
      </VStack>

      <Card padding={4}>
        <VStack gap={3}>
          <MetadataList>
            <MetadataListItem label="Заведение">{tenant.name}</MetadataListItem>
            <MetadataListItem label="Вы вошли как">{email}</MetadataListItem>
            <MetadataListItem label="Роль">{role === 'owner' ? 'владелец' : 'персонал'}</MetadataListItem>
          </MetadataList>
          <Link href={`/s/${tenant.slug}/`}>Страница для гостей</Link>
          {logout.isError && <Banner status="error" title="Не удалось выйти" description={ownerErrorMessage(logout.error)} />}
          <Button variant="secondary" label="Выйти" isLoading={logout.isPending} onClick={() => logout.mutate()} />
          <Text color="secondary">При выходе данные кабинета удаляются с этого устройства.</Text>
        </VStack>
      </Card>
    </VStack>
  );
}

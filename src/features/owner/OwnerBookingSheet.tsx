import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { BottomSheet } from '@astryxdesign/core/BottomSheet';
import { Button } from '@astryxdesign/core/Button';
import { Calendar, type ISODateString } from '@astryxdesign/core/Calendar';
import { Divider } from '@astryxdesign/core/Divider';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Item } from '@astryxdesign/core/Item';
import { Link } from '@astryxdesign/core/Link';
import { List } from '@astryxdesign/core/List';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { dateInTz, formatRangeInTz, formatRub, todayInTz } from '../../shared/format';
import { PriceLines } from '../booking/PriceLines';
import { ownerApi, ownerErrorMessage, paidAmount, type OwnerBooking } from './ownerApi';
import { ownerKey, refreshOwnerData, useOwner } from './ownerContext';
import { guestsLabel, SOURCE_LABEL, STATUS_LABEL } from './labels';

type PayKind = 'deposit' | 'payment' | 'refund';
type Method = 'cash' | 'transfer' | 'card';
const PAY_LABEL: Record<PayKind, string> = {
  deposit: 'задаток',
  payment: 'оплату',
  refund: 'возврат',
};

/** Детали брони и действия владельца. */
export function OwnerBookingSheet({
  booking: b,
  hallName,
  onClose,
}: {
  booking: OwnerBooking;
  hallName: string;
  onClose: () => void;
}) {
  const { tenant, halls } = useOwner();
  const tz = tenant.timezone;
  const queryClient = useQueryClient();
  const paid = paidAmount(b);
  const left = Math.max(0, b.total_amount - paid);
  const deposit = b.price_snapshot.deposit_amount ?? 0;
  const isActive = b.status === 'confirmed' || b.status === 'pending';
  const duration = Math.round(
    (new Date(b.end_at).getTime() - new Date(b.start_at).getTime()) / 60_000,
  );

  const [payKind, setPayKind] = useState<PayKind>(
    paid === 0 && deposit > 0 ? 'deposit' : 'payment',
  );
  const [amountRub, setAmountRub] = useState(
    Math.round((paid === 0 && deposit > 0 ? deposit : left) / 100),
  );
  const [method, setMethod] = useState<Method>('transfer');
  const [moving, setMoving] = useState(false);
  const [moveDate, setMoveDate] = useState(dateInTz(b.start_at, tz));
  const [confirmCancel, setConfirmCancel] = useState(false);

  const refresh = () => refreshOwnerData(queryClient, tenant.id);

  const pay = useMutation({
    mutationFn: () => ownerApi.addPayment(b.id, payKind, Math.round(amountRub * 100), method),
    // Кнопка остаётся в загрузке, пока календарь и суммы не обновятся.
    onSuccess: () => refresh(),
  });
  const status = useMutation({
    mutationFn: (s: 'confirmed' | 'completed' | 'no_show') => ownerApi.setStatus(b.id, s),
    onSuccess: () => refresh(),
  });
  const cancel = useMutation({
    mutationFn: () => ownerApi.cancel(b.id),
    onSuccess: async () => {
      await refresh();
      setConfirmCancel(false);
      onClose();
    },
  });
  const move = useMutation({
    mutationFn: (startAt: string) => ownerApi.reschedule(b.id, startAt, duration, b.version),
    onSuccess: async () => {
      await refresh();
      setMoving(false);
      onClose();
    },
  });
  const slots = useQuery({
    queryKey: ownerKey(tenant.id, 'move', b.id, moveDate, duration),
    queryFn: () => ownerApi.availability(tenant.slug, b.hall_id, moveDate, duration),
    enabled: moving && halls.some((h) => h.id === b.hall_id),
  });

  const actionError = pay.error ?? status.error ?? move.error ?? cancel.error;

  return (
    <BottomSheet
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      label="Бронь"
      height="tall"
    >
      <VStack gap={5}>
        <HStack justify="between" vAlign="center">
          <Text color="secondary">{`${hallName} · ${STATUS_LABEL[b.status]}`}</Text>
          <Button variant="ghost" size="sm" label="Закрыть" onClick={onClose} />
        </HStack>
        <VStack gap={1}>
          <Heading level={2}>{b.customer_name}</Heading>
          <Text>{formatRangeInTz(b.start_at, b.end_at, tz)}</Text>
        </VStack>

        <MetadataList>
          <MetadataListItem label="Гости">{guestsLabel(b.guests)}</MetadataListItem>
          <MetadataListItem label="Телефон">
            {b.customer_phone ? (
              <Link href={`tel:${b.customer_phone}`}>{b.customer_phone}</Link>
            ) : (
              'не указан'
            )}
          </MetadataListItem>
          <MetadataListItem label="Источник">{SOURCE_LABEL[b.source]}</MetadataListItem>
          {b.comment && <MetadataListItem label="Комментарий">{b.comment}</MetadataListItem>}
        </MetadataList>

        <PriceLines snapshot={b.price_snapshot} total={b.total_amount} deposit={deposit} />
        <Text weight="semibold">{`Получено ${formatRub(paid)} · осталось ${formatRub(left)}`}</Text>

        {actionError && (
          <Banner
            status="error"
            title="Не получилось"
            description={ownerErrorMessage(actionError)}
          />
        )}

        {b.status !== 'cancelled' && (
          <VStack gap={3}>
            <Divider />
            <Heading level={3}>Деньги</Heading>
            <SegmentedControl
              label="Тип платежа"
              layout="fill"
              value={payKind}
              onChange={(v) => setPayKind(v as PayKind)}
            >
              <SegmentedControlItem value="deposit" label="Задаток" />
              <SegmentedControlItem value="payment" label="Оплата" />
              <SegmentedControlItem value="refund" label="Возврат" />
            </SegmentedControl>
            <NumberInput
              label="Сумма, ₽"
              value={amountRub}
              min={1}
              step={100}
              onChange={(n) => setAmountRub(Math.max(0, Math.round(n)))}
            />
            <SegmentedControl
              label="Способ"
              layout="fill"
              value={method}
              onChange={(v) => setMethod(v as Method)}
            >
              <SegmentedControlItem value="transfer" label="Перевод" />
              <SegmentedControlItem value="cash" label="Наличные" />
              <SegmentedControlItem value="card" label="Карта" />
            </SegmentedControl>
            <Button
              variant="primary"
              label={`Отметить ${PAY_LABEL[payKind]}`}
              isLoading={pay.isPending}
              isDisabled={amountRub <= 0}
              onClick={() => pay.mutate()}
            />
            {pay.isSuccess && <Text color="secondary">Платёж записан.</Text>}
          </VStack>
        )}

        {b.status !== 'cancelled' && (
          <VStack gap={3}>
            <Divider />
            <Heading level={3}>Визит</Heading>
            {isActive ? (
              <HStack gap={2} wrap="wrap">
                <Button
                  variant="secondary"
                  label="Гости пришли"
                  isLoading={status.isPending && status.variables === 'completed'}
                  onClick={() => status.mutate('completed')}
                />
                <Button
                  variant="secondary"
                  label="Не пришли"
                  isLoading={status.isPending && status.variables === 'no_show'}
                  onClick={() => status.mutate('no_show')}
                />
                <Button
                  variant="secondary"
                  label="Перенести"
                  onClick={() => setMoving((m) => !m)}
                />
              </HStack>
            ) : (
              <Button
                variant="secondary"
                label="Вернуть в подтверждённые"
                isLoading={status.isPending}
                onClick={() => status.mutate('confirmed')}
              />
            )}
          </VStack>
        )}

        {moving && (
          <VStack gap={3}>
            <Text weight="semibold">Новая дата и время (та же длительность)</Text>
            <Calendar
              mode="single"
              value={moveDate as ISODateString}
              min={todayInTz(tz) as ISODateString}
              weekStartsOn="mon"
              hasVariableRowCount
              onChange={(v: unknown) => {
                if (typeof v === 'string') setMoveDate(v);
              }}
            />
            {slots.isPending ? (
              <Skeleton height={120} />
            ) : slots.isError ? (
              <Banner
                status="error"
                title="Не удалось загрузить время"
                description={ownerErrorMessage(slots.error)}
              />
            ) : slots.data.slots.length === 0 ? (
              <Text color="secondary">
                {slots.data.closed ? 'В этот день закрыто' : 'Свободного времени нет'}
              </Text>
            ) : (
              <List hasDividers>
                {slots.data.slots.map((s) => (
                  <Item
                    key={s.start_at}
                    label={`${s.local_start}–${s.local_end}`}
                    endContent={<Text hasTabularNumbers>{formatRub(s.total)}</Text>}
                    onClick={() => move.mutate(s.start_at)}
                  />
                ))}
              </List>
            )}
          </VStack>
        )}

        {isActive && (
          <VStack gap={2}>
            <Divider />
            <Button
              variant="destructive"
              label="Отменить бронь"
              onClick={() => setConfirmCancel(true)}
            />
          </VStack>
        )}
      </VStack>

      <AlertDialog
        isOpen={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Отменить бронь?"
        description={`${b.customer_name}, ${formatRangeInTz(b.start_at, b.end_at, tz)}. Время освободится для гостей.`}
        actionLabel="Отменить бронь"
        cancelLabel="Не отменять"
        isActionLoading={cancel.isPending}
        onAction={() => cancel.mutate()}
      />
    </BottomSheet>
  );
}

import { Button } from '@astryxdesign/core/Button';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { formatRub } from '../../shared/format';
import { ownerApi } from './ownerApi';

type PayKind = 'deposit' | 'payment' | 'refund';
type Method = 'cash' | 'transfer' | 'card';
const PAY_LABEL: Record<PayKind, string> = {
  deposit: 'задаток',
  payment: 'оплату',
  refund: 'возврат',
};

/**
 * Деньги по брони. Родитель пересоздаёт форму после каждого платежа (key = получено),
 * поэтому тип и сумма по умолчанию всегда считаются от текущего остатка: задаток →
 * остаток → «оплачено полностью». Нельзя внести больше остатка и вернуть больше полученного.
 */
export function PaymentForm({
  bookingId,
  paid,
  left,
  deposit,
  onSaved,
  onError,
}: {
  bookingId: string;
  paid: number;
  left: number;
  deposit: number;
  onSaved: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const initialKind: PayKind =
    left === 0 ? 'refund' : paid === 0 && deposit > 0 ? 'deposit' : 'payment';
  const [kind, setKind] = useState<PayKind>(initialKind);
  const [refundOpen, setRefundOpen] = useState(false);
  const defaultFor = (k: PayKind) =>
    Math.round((k === 'deposit' ? Math.min(deposit, left) : k === 'payment' ? left : paid) / 100);
  const [amountRub, setAmountRub] = useState(defaultFor(initialKind));
  const [method, setMethod] = useState<Method>('transfer');

  const limit = kind === 'refund' ? paid : left; // копейки
  const amount = Math.round(amountRub * 100);
  const tooMuch = amount > limit;

  const pay = useMutation({
    mutationFn: () => ownerApi.addPayment(bookingId, kind, amount, method),
    onSuccess: () => onSaved(),
    onError,
  });

  // Оплачено полностью: вместо формы — итог и возможность оформить возврат.
  if (left === 0 && !refundOpen) {
    return (
      <VStack gap={2}>
        <Text weight="semibold">Оплачено полностью ✓</Text>
        {paid > 0 && (
          <Button
            variant="ghost"
            size="sm"
            label="Оформить возврат"
            onClick={() => setRefundOpen(true)}
          />
        )}
      </VStack>
    );
  }

  return (
    <VStack gap={3}>
      {left > 0 && (
        <SegmentedControl
          label="Тип платежа"
          layout="fill"
          value={kind}
          onChange={(v) => {
            setKind(v as PayKind);
            setAmountRub(defaultFor(v as PayKind));
          }}
        >
          <SegmentedControlItem value="deposit" label="Задаток" />
          <SegmentedControlItem value="payment" label="Оплата" />
          {paid > 0 && <SegmentedControlItem value="refund" label="Возврат" />}
        </SegmentedControl>
      )}
      <NumberInput
        label="Сумма, ₽"
        value={amountRub}
        min={1}
        step={100}
        onChange={(n) => setAmountRub(Math.max(0, Math.round(n)))}
        status={
          tooMuch
            ? {
                type: 'error',
                message: `Не больше ${formatRub(limit)} (${kind === 'refund' ? 'получено' : 'осталось'})`,
              }
            : undefined
        }
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
        label={`Отметить ${PAY_LABEL[kind]}`}
        isLoading={pay.isPending}
        isDisabled={amount <= 0 || tooMuch}
        onClick={() => pay.mutate()}
      />
    </VStack>
  );
}

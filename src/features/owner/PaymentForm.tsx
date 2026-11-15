import { Button } from '@astryxdesign/core/Button';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { formatRub } from '../../shared/format';
import { ownerApi, type Method, type OwnerBooking } from './ownerApi';

/**
 * Деньги по брони. Задаток — одна отметка «получен / не получен» (переключатель),
 * оплата — не больше остатка. Родитель пересоздаёт форму после каждого изменения
 * (key), поэтому суммы по умолчанию всегда считаются от текущих данных.
 */
export function PaymentForm({
  booking: b,
  depositEnabled,
  onSaved,
  onError,
}: {
  booking: OwnerBooking;
  depositEnabled: boolean;
  onSaved: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const depositPaid = b.payments
    .filter((p) => p.kind === 'deposit')
    .reduce((s, p) => s + p.amount, 0);
  const paid = b.payments.reduce((s, p) => s + (p.kind === 'refund' ? -p.amount : p.amount), 0);
  const left = Math.max(0, b.total_amount - paid);
  const depositDefault = b.price_snapshot.deposit_amount ?? 0;

  const [depositRub, setDepositRub] = useState(Math.round(depositDefault / 100));
  const [amountRub, setAmountRub] = useState(Math.round(left / 100));
  const [method, setMethod] = useState<Method>('transfer');

  const deposit = useMutation({
    mutationFn: (amount: number | null) => ownerApi.setDeposit(b.id, amount, method),
    onSuccess: () => onSaved(),
    onError,
  });
  const pay = useMutation({
    mutationFn: () => ownerApi.addPayment(b.id, Math.round(amountRub * 100), method),
    onSuccess: () => onSaved(),
    onError,
  });

  const depositAmount = Math.round(depositRub * 100);
  const depositTooMuch = depositAmount > b.total_amount;
  const amount = Math.round(amountRub * 100);
  const tooMuch = amount > left;

  return (
    <VStack gap={4}>
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

      {depositEnabled && (
        <VStack gap={2}>
          <Switch
            label={
              depositPaid > 0 ? `Задаток получен: ${formatRub(depositPaid)}` : 'Задаток получен'
            }
            description={
              depositPaid > 0
                ? 'Выключите, если отметили по ошибке'
                : 'Включите, когда гость оставил задаток'
            }
            value={depositPaid > 0}
            isLoading={deposit.isPending}
            isDisabled={depositPaid === 0 && (depositAmount <= 0 || depositTooMuch)}
            onChange={(on) => deposit.mutate(on ? depositAmount : null)}
          />
          {depositPaid === 0 && (
            <NumberInput
              label="Сумма задатка, ₽"
              value={depositRub}
              min={1}
              step={100}
              onChange={(n) => setDepositRub(Math.max(0, Math.round(n)))}
              status={
                depositTooMuch
                  ? { type: 'error', message: `Не больше ${formatRub(b.total_amount)}` }
                  : undefined
              }
            />
          )}
        </VStack>
      )}

      {left === 0 ? (
        <Text weight="semibold">Оплачено полностью ✓</Text>
      ) : (
        <VStack gap={2}>
          <NumberInput
            label="Оплата, ₽"
            value={amountRub}
            min={1}
            step={100}
            onChange={(n) => setAmountRub(Math.max(0, Math.round(n)))}
            status={
              tooMuch
                ? { type: 'error', message: `Не больше ${formatRub(left)} (осталось)` }
                : undefined
            }
          />
          <Button
            variant="primary"
            label="Отметить оплату"
            isLoading={pay.isPending}
            isDisabled={amount <= 0 || tooMuch}
            onClick={() => pay.mutate()}
          />
        </VStack>
      )}
    </VStack>
  );
}

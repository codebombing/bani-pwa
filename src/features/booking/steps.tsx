import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Calendar, type ISODateString } from '@astryxdesign/core/Calendar';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { HStack } from '@astryxdesign/core/HStack';
import { Item } from '@astryxdesign/core/Item';
import { Link } from '@astryxdesign/core/Link';
import { List } from '@astryxdesign/core/List';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { ToggleButton, ToggleButtonGroup } from '@astryxdesign/core/ToggleButton';
import { VStack } from '@astryxdesign/core/VStack';
import { useMutation } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';

import {
  addDays,
  formatDateLong,
  formatDuration,
  formatRangeInTz,
  formatRub,
  formatRuPhoneInput,
  normalizeRuPhone,
  todayInTz,
} from '../../shared/format';
import {
  ApiError,
  errorMessage,
  publicApi,
  type Booking,
  type Extra,
  type ExtraChoice,
  type Hall,
  type Slot,
  type Tenant,
} from './api';
import type { Draft } from './BookingFlow';
import { PriceLines } from './PriceLines';
import { useAvailability, useQuote } from './queries';

const BOOKING_HORIZON_DAYS = 60;

/* ---------- Зал ---------- */

export function HallStep({
  halls,
  selectedId,
  onSelect,
}: {
  halls: Hall[];
  selectedId: string | null;
  onSelect: (hall: Hall) => void;
}) {
  if (halls.length === 0) {
    return <EmptyState title="Нет залов для брони" description="Позвоните в заведение." />;
  }
  return (
    <List hasDividers>
      {halls.map((h) => (
        <Item
          key={h.id}
          label={h.name}
          description={`До ${h.capacity_max} гостей · от ${formatDuration(h.min_duration_min)}${h.description ? ` · ${h.description}` : ''}`}
          isSelected={h.id === selectedId}
          onClick={() => onSelect(h)}
        />
      ))}
    </List>
  );
}

/* ---------- Дата ---------- */

export function DateStep({
  timezone,
  value,
  onSelect,
}: {
  timezone: string;
  value: string | null;
  onSelect: (date: string) => void;
}) {
  const today = todayInTz(timezone);
  return (
    <VStack gap={3}>
      <Calendar
        mode="single"
        value={(value as ISODateString | null) ?? null}
        min={today as ISODateString}
        max={addDays(today, BOOKING_HORIZON_DAYS) as ISODateString}
        weekStartsOn="mon"
        hasVariableRowCount
        onChange={(next: unknown) => {
          if (typeof next === 'string') onSelect(next);
        }}
      />
      <Text color="secondary">{`Бронь открыта на ${BOOKING_HORIZON_DAYS} дней вперёд. Время — местное для заведения.`}</Text>
    </VStack>
  );
}

/* ---------- Время и длительность ---------- */

function durationOptions(hall: Hall): number[] {
  return Array.from({ length: 5 }, (_, i) => hall.min_duration_min + i * hall.slot_step_min).filter(
    (d) => d <= 12 * 60,
  );
}

export function TimeStep({
  slug,
  hall,
  date,
  duration,
  selected,
  onDuration,
  onChangeDate,
  onSelect,
}: {
  slug: string;
  hall: Hall;
  date: string;
  duration: number;
  selected: Slot | null;
  onDuration: (minutes: number) => void;
  onChangeDate: () => void;
  onSelect: (slot: Slot) => void;
}) {
  const availability = useAvailability(slug, { hall_id: hall.id, date, duration_min: duration });

  return (
    <VStack gap={4}>
      <Text color="secondary">{`${hall.name} · ${formatDateLong(date)}`}</Text>
      <ToggleButtonGroup
        label="Длительность"
        type="single"
        value={String(duration)}
        onChange={(v) => {
          if (typeof v === 'string') onDuration(Number(v));
        }}
      >
        {durationOptions(hall).map((d) => (
          <ToggleButton key={d} value={String(d)} label={formatDuration(d)} />
        ))}
      </ToggleButtonGroup>

      {availability.isPending && (
        <VStack gap={2}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={48} index={i} />
          ))}
        </VStack>
      )}
      {availability.isError && (
        <Banner
          status="error"
          title="Не удалось загрузить свободное время"
          description={errorMessage(availability.error)}
          endContent={<Button label="Повторить" onClick={() => void availability.refetch()} />}
        />
      )}
      {availability.isSuccess &&
        (availability.data.closed || availability.data.slots.length === 0 ? (
          <EmptyState
            title={availability.data.closed ? 'В этот день закрыто' : 'Свободного времени нет'}
            description={
              availability.data.closed
                ? 'Выберите другую дату.'
                : 'Попробуйте другую длительность или дату.'
            }
            actions={<Button label="Другая дата" onClick={onChangeDate} />}
          />
        ) : (
          <List hasDividers>
            {availability.data.slots.map((slot) => (
              <Item
                key={slot.start_at}
                label={`${slot.local_start}–${slot.local_end}`}
                endContent={<Text hasTabularNumbers>{formatRub(slot.total)}</Text>}
                isSelected={selected?.start_at === slot.start_at}
                onClick={() => onSelect(slot)}
              />
            ))}
          </List>
        ))}
      <Text color="secondary">{`Цена для ${hall.capacity_included} гостей без допов. Между гостями — уборка и протопка.`}</Text>
    </VStack>
  );
}

/* ---------- Гости и допы ---------- */

const UNIT_LABEL: Record<Extra['unit'], string> = {
  per_booking: 'за штуку',
  per_hour: 'в час',
  per_guest: 'на гостя',
};

function toChoices(extras: Record<string, number>): ExtraChoice[] {
  return Object.entries(extras)
    .filter(([, qty]) => qty > 0)
    .map(([extra_id, qty]) => ({ extra_id, qty }));
}

export function GuestsStep({
  slug,
  hall,
  extras,
  slot,
  duration,
  guests,
  chosen,
  onChange,
  onNext,
}: {
  slug: string;
  hall: Hall;
  extras: Extra[];
  slot: Slot;
  duration: number;
  guests: number;
  chosen: Record<string, number>;
  onChange: (guests: number, extras: Record<string, number>) => void;
  onNext: () => void;
}) {
  const quoteInput = useMemo(
    () => ({
      hall_id: hall.id,
      start_at: slot.start_at,
      duration_min: duration,
      guests,
      extras: toChoices(chosen),
    }),
    [hall.id, slot.start_at, duration, guests, chosen],
  );
  const quote = useQuote(slug, quoteInput);

  const maxQty = (e: Extra) => (e.unit === 'per_guest' ? Math.min(e.max_qty, guests) : e.max_qty);

  const setGuests = (n: number) => {
    const clamped = Math.max(1, Math.min(hall.capacity_max, Math.round(n)));
    // Допы «на гостя» не могут превышать число гостей.
    const next = { ...chosen };
    for (const e of extras) {
      const q = next[e.id];
      if (e.unit === 'per_guest' && q !== undefined && q > clamped) next[e.id] = clamped;
    }
    onChange(clamped, next);
  };

  return (
    <VStack gap={4}>
      <NumberInput
        label="Гостей"
        value={guests}
        min={1}
        max={hall.capacity_max}
        step={1}
        description={`Включено ${hall.capacity_included}, максимум ${hall.capacity_max}${
          hall.extra_guest_price > 0
            ? `. Сверх — ${formatRub(hall.extra_guest_price)} за человека${hall.extra_guest_unit === 'per_hour' ? ' в час' : ''}`
            : ''
        }`}
        onChange={setGuests}
      />

      {extras.length > 0 && (
        <VStack gap={3}>
          <Text weight="semibold">Допы</Text>
          {extras.map((e) => {
            const qty = chosen[e.id] ?? 0;
            return (
              <VStack key={e.id} gap={2}>
                <CheckboxInput
                  label={`${e.name} — ${formatRub(e.price)} ${UNIT_LABEL[e.unit]}`}
                  description={e.description || undefined}
                  value={qty > 0}
                  onChange={(checked) =>
                    onChange(guests, {
                      ...chosen,
                      [e.id]: checked ? (e.unit === 'per_guest' ? guests : 1) : 0,
                    })
                  }
                />
                {qty > 0 && maxQty(e) > 1 && (
                  <NumberInput
                    label={`Количество: ${e.name}`}
                    value={qty}
                    min={1}
                    max={maxQty(e)}
                    step={1}
                    size="sm"
                    onChange={(n) =>
                      onChange(guests, {
                        ...chosen,
                        [e.id]: Math.max(1, Math.min(maxQty(e), Math.round(n))),
                      })
                    }
                  />
                )}
              </VStack>
            );
          })}
        </VStack>
      )}

      {quote.isError ? (
        <Banner
          status="error"
          title="Не удалось посчитать цену"
          description={errorMessage(quote.error)}
        />
      ) : (
        <HStack justify="between" vAlign="center">
          <Text weight="semibold">Итого</Text>
          {quote.data ? (
            <Text weight="semibold" hasTabularNumbers>
              {formatRub(quote.data.total)}
            </Text>
          ) : (
            <Skeleton width={96} height={24} />
          )}
        </HStack>
      )}

      <Button
        variant="primary"
        size="lg"
        width="100%"
        label="Далее"
        isDisabled={!quote.data || quote.isError}
        onClick={onNext}
      />
    </VStack>
  );
}

/* ---------- Контакты ---------- */

export interface Contacts {
  name: string;
  phone: string;
  comment: string;
  consent: boolean;
}

export function ContactsStep({
  tenant,
  value,
  onChange,
  onNext,
}: {
  tenant: Tenant;
  value: Contacts;
  onChange: (c: Contacts) => void;
  onNext: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const nameError = value.name.trim() === '' ? 'Укажите имя' : null;
  const phoneError = normalizeRuPhone(value.phone) ? null : 'Номер из 10 цифр после +7';
  const consentError = value.consent ? null : 'Без согласия бронь оформить нельзя';
  const valid = !nameError && !phoneError && !consentError;

  return (
    <VStack gap={4}>
      <TextInput
        label="Имя"
        value={value.name}
        isRequired
        autoComplete="name"
        onChange={(name) => onChange({ ...value, name })}
        status={touched && nameError ? { type: 'error', message: nameError } : undefined}
      />
      <TextInput
        label="Телефон"
        type="tel"
        value={value.phone}
        isRequired
        autoComplete="tel"
        placeholder="+7 900 000-00-00"
        description="Заведение позвонит, если что-то изменится"
        onChange={(phone) => onChange({ ...value, phone: formatRuPhoneInput(phone) })}
        status={touched && phoneError ? { type: 'error', message: phoneError } : undefined}
      />
      <TextArea
        label="Комментарий"
        value={value.comment}
        isOptional
        rows={2}
        maxLength={1000}
        onChange={(comment) => onChange({ ...value, comment })}
      />
      <VStack gap={1}>
        <CheckboxInput
          label="Согласен на обработку персональных данных"
          value={value.consent}
          isRequired
          onChange={(consent) => onChange({ ...value, consent })}
          status={touched && consentError ? { type: 'error', message: consentError } : undefined}
        />
        <Text color="secondary">
          {`Оператор — ${tenant.legal.operator_name ?? tenant.name}. `}
          {tenant.legal.privacy_policy_url && (
            <Link href={tenant.legal.privacy_policy_url} isExternalLink>
              Политика обработки персональных данных
            </Link>
          )}
        </Text>
      </VStack>
      <Button
        variant="primary"
        size="lg"
        width="100%"
        label="Далее"
        onClick={() => {
          setTouched(true);
          if (valid) onNext();
        }}
      />
    </VStack>
  );
}

/* ---------- Подтверждение ---------- */

export function ConfirmStep({
  tenant,
  hall,
  draft,
  extras,
  onSlotTaken,
  onCreated,
}: {
  tenant: Tenant;
  hall: Hall;
  draft: Draft;
  extras: Extra[];
  onSlotTaken: () => void;
  onCreated: (token: string, booking: Booking) => void;
}) {
  const slot = draft.slot;
  const duration = draft.duration ?? hall.min_duration_min;
  const choices = toChoices(draft.extras);
  const quote = useQuote(
    tenant.slug,
    slot
      ? {
          hall_id: hall.id,
          start_at: slot.start_at,
          duration_min: duration,
          guests: draft.guests,
          extras: choices,
        }
      : null,
  );
  // Один ключ на попытку: повтор после сбоя сети вернёт ту же бронь, а не создаст вторую.
  const idempotencyKey = useRef(crypto.randomUUID());

  const create = useMutation({
    mutationFn: () => {
      const phone = normalizeRuPhone(draft.contacts.phone);
      if (!slot || !phone) throw new ApiError('VALIDATION_ERROR', 'Проверьте время и телефон', 400);
      return publicApi.create(tenant.slug, {
        hall_id: hall.id,
        start_at: slot.start_at,
        duration_min: duration,
        guests: draft.guests,
        extras: choices,
        customer_name: draft.contacts.name.trim(),
        customer_phone: phone,
        comment: draft.contacts.comment.trim() || undefined,
        consent: true,
        idempotency_key: idempotencyKey.current,
      });
    },
    onSuccess: (res) => onCreated(res.token, res.booking),
    onError: (err) => {
      // Ответ сервера по существу — следующая попытка будет новым запросом.
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        idempotencyKey.current = crypto.randomUUID();
      }
    },
  });

  if (!slot) return null;
  const error = create.error instanceof ApiError ? create.error : null;
  const extraNames = choices
    .map((c) => {
      const e = extras.find((x) => x.id === c.extra_id);
      return e ? `${e.name}${c.qty > 1 ? ` × ${c.qty}` : ''}` : null;
    })
    .filter(Boolean)
    .join(', ');

  return (
    <VStack gap={4}>
      <MetadataList>
        <MetadataListItem label="Зал">{hall.name}</MetadataListItem>
        <MetadataListItem label="Когда">
          {formatRangeInTz(slot.start_at, slot.end_at, tenant.timezone)}
        </MetadataListItem>
        <MetadataListItem label="Гостей">{String(draft.guests)}</MetadataListItem>
        {extraNames && <MetadataListItem label="Допы">{extraNames}</MetadataListItem>}
        <MetadataListItem label="Контакт">{`${draft.contacts.name.trim()}, ${formatRuPhoneInput(draft.contacts.phone)}`}</MetadataListItem>
      </MetadataList>

      {quote.isPending && <Skeleton height={120} />}
      {quote.isError && (
        <Banner
          status="error"
          title="Не удалось посчитать цену"
          description={errorMessage(quote.error)}
          endContent={<Button label="Повторить" onClick={() => void quote.refetch()} />}
        />
      )}
      {quote.data && (
        <PriceLines snapshot={quote.data.snapshot} total={quote.data.total} />
      )}

      {tenant.texts.booking_note && <Text color="secondary">{tenant.texts.booking_note}</Text>}

      {error && (
        <Banner
          status="error"
          title={error.code === 'SLOT_TAKEN' ? 'Это время только что заняли' : 'Бронь не создана'}
          description={error.message}
          endContent={
            error.code === 'SLOT_TAKEN' ? (
              <Button label="Выбрать другое время" onClick={onSlotTaken} />
            ) : undefined
          }
        />
      )}

      <Button
        variant="primary"
        size="lg"
        width="100%"
        label={create.isError ? 'Попробовать ещё раз' : 'Подтвердить бронь'}
        isLoading={create.isPending}
        isDisabled={!quote.data || error?.code === 'SLOT_TAKEN'}
        onClick={() => create.mutate()}
      />
    </VStack>
  );
}

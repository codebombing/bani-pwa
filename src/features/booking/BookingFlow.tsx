import { BottomSheet } from '@astryxdesign/core/BottomSheet';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import type { Catalog, Slot } from './api';
import { rememberBooking } from './myBookings';
import { bookingKeys } from './queries';
import {
  ConfirmStep,
  ContactsStep,
  DateStep,
  GuestsStep,
  HallStep,
  TimeStep,
  type Contacts,
} from './steps';
import { useStepHistory } from './useStepHistory';

export type Step = 'hall' | 'date' | 'time' | 'guests' | 'contacts' | 'confirm';

const TITLES: Record<Step, string> = {
  hall: 'Выберите зал',
  date: 'Выберите дату',
  time: 'Время и длительность',
  guests: 'Гости и допы',
  contacts: 'Контакты',
  confirm: 'Проверьте бронь',
};
const STEPS: Step[] = ['hall', 'date', 'time', 'guests', 'contacts', 'confirm'];

export interface Draft {
  hallId: string | null;
  date: string | null;
  duration: number | null;
  slot: Slot | null;
  guests: number;
  extras: Record<string, number>;
  contacts: Contacts;
}

interface Props {
  catalog: Catalog;
  initialHallId?: string;
  onClosed: () => void;
}

/** Последовательная bottom sheet брони: зал → дата → время → гости и допы → контакты → подтверждение. */
export function BookingFlow({ catalog, initialHallId, onClosed }: Props) {
  const slug = catalog.tenant.slug;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const initialHall = catalog.halls.find((h) => h.id === initialHallId);
  const flow = useStepHistory<Step>(initialHall ? 'date' : 'hall', onClosed);

  const [draft, setDraft] = useState<Draft>({
    hallId: initialHall?.id ?? null,
    date: null,
    duration: initialHall?.min_duration_min ?? null,
    slot: null,
    guests: Math.min(2, initialHall?.capacity_max ?? 2),
    extras: {},
    contacts: { name: '', phone: '', comment: '', consent: false },
  });
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const hall = catalog.halls.find((h) => h.id === draft.hallId) ?? null;

  const sheet = (step: Step, body: ReactNode, purpose: 'info' | 'form' = 'info') => (
    <BottomSheet
      key={step}
      isOpen={flow.step === step}
      onOpenChange={(open) => {
        if (!open) flow.back();
      }}
      label={TITLES[step]}
      height="tall"
      purpose={purpose}
    >
      <VStack gap={4}>
        <HStack gap={2} vAlign="center" justify="between">
          {flow.index > 1 ? (
            <Button variant="ghost" size="sm" label="Назад" onClick={flow.back} />
          ) : (
            <Text color="secondary">Бронь</Text>
          )}
          <Text color="secondary">{`Шаг ${STEPS.indexOf(step) + 1} из ${STEPS.length}`}</Text>
          <Button variant="ghost" size="sm" label="Закрыть" onClick={() => flow.close()} />
        </HStack>
        <Heading level={2}>{TITLES[step]}</Heading>
        {body}
      </VStack>
    </BottomSheet>
  );

  return (
    <>
      {sheet(
        'hall',
        <HallStep
          halls={catalog.halls}
          selectedId={draft.hallId}
          onSelect={(h) => {
            update({
              hallId: h.id,
              duration: h.min_duration_min,
              slot: null,
              guests: Math.min(draft.guests, h.capacity_max),
            });
            flow.push('date');
          }}
        />,
      )}
      {sheet(
        'date',
        <DateStep
          timezone={catalog.tenant.timezone}
          value={draft.date}
          onSelect={(date) => {
            update({ date, slot: null });
            flow.push('time');
          }}
        />,
      )}
      {hall && draft.date && draft.duration
        ? sheet(
            'time',
            <TimeStep
              slug={slug}
              hall={hall}
              date={draft.date}
              duration={draft.duration}
              selected={draft.slot}
              onDuration={(duration) => update({ duration, slot: null })}
              onChangeDate={flow.back}
              onSelect={(slot) => {
                update({ slot });
                flow.push('guests');
              }}
            />,
          )
        : null}
      {hall && draft.slot
        ? sheet(
            'guests',
            <GuestsStep
              slug={slug}
              hall={hall}
              extras={catalog.extras}
              slot={draft.slot}
              duration={draft.duration ?? hall.min_duration_min}
              guests={draft.guests}
              chosen={draft.extras}
              onChange={(guests, extras) => update({ guests, extras })}
              onNext={() => flow.push('contacts')}
            />,
          )
        : null}
      {sheet(
        'contacts',
        <ContactsStep
          tenant={catalog.tenant}
          value={draft.contacts}
          onChange={(contacts) => update({ contacts })}
          onNext={() => flow.push('confirm')}
        />,
        'form',
      )}
      {hall && draft.slot
        ? sheet(
            'confirm',
            <ConfirmStep
              tenant={catalog.tenant}
              hall={hall}
              draft={draft}
              extras={catalog.extras}
              onSlotTaken={() => {
                void queryClient.invalidateQueries({ queryKey: bookingKeys.availability(slug) });
                update({ slot: null });
                flow.backTo('time');
              }}
              onCreated={(token, booking) => {
                rememberBooking(slug, {
                  token,
                  start_at: booking.start_at,
                  hall_name: booking.hall_name,
                });
                void queryClient.invalidateQueries({ queryKey: bookingKeys.availability(slug) });
                flow.close(() => navigate(`/s/${slug}/b/${token}`));
              }}
            />,
            'form',
          )
        : null}
    </>
  );
}

import { Banner } from '@astryxdesign/core/Banner';
import { BottomSheet } from '@astryxdesign/core/BottomSheet';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { errorMessage, publicApi, type Booking, type Hall, type Slot } from './api';
import { bookingKeys } from './queries';
import { DateStep, TimeStep } from './steps';

/** Перенос брони гостем: дата → свободное время → подтверждение. Цену пересчитывает сервер. */
export function RescheduleSheet({
  slug,
  token,
  booking,
  hall,
  onClose,
}: {
  slug: string;
  token: string;
  booking: Booking;
  hall: Hall;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState<string | null>(null);
  const [duration, setDuration] = useState(booking.duration_min);
  const [slot, setSlot] = useState<Slot | null>(null);

  const move = useMutation({
    mutationFn: (s: Slot) =>
      publicApi.reschedule(slug, token, {
        start_at: s.start_at,
        duration_min: duration,
        expected_version: booking.version,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(bookingKeys.booking(slug, token), data);
      void queryClient.invalidateQueries({ queryKey: bookingKeys.availability(slug) });
      onClose();
    },
  });

  return (
    <BottomSheet
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      label="Перенос брони"
      height="tall"
    >
      <VStack gap={4}>
        <HStack gap={2} vAlign="center" justify="between">
          {date ? (
            <Button
              variant="ghost"
              size="sm"
              label="Назад"
              onClick={() => {
                setDate(null);
                setSlot(null);
              }}
            />
          ) : (
            <Text color="secondary">{booking.hall_name}</Text>
          )}
          <Button variant="ghost" size="sm" label="Закрыть" onClick={onClose} />
        </HStack>
        <Heading level={2}>{date ? 'Новое время' : 'Новая дата'}</Heading>

        {!date ? (
          <DateStep timezone={booking.timezone} value={null} onSelect={setDate} />
        ) : (
          <TimeStep
            slug={slug}
            hall={hall}
            date={date}
            duration={duration}
            selected={slot}
            onDuration={(d) => {
              setDuration(d);
              setSlot(null);
            }}
            onChangeDate={() => setDate(null)}
            onSelect={setSlot}
          />
        )}

        {move.isError && (
          <Banner
            status="error"
            title="Не удалось перенести"
            description={errorMessage(move.error)}
          />
        )}
        {slot && (
          <VStack gap={2}>
            <Text color="secondary">
              Цена пересчитается по тарифу нового времени, внесённые деньги сохраняются.
            </Text>
            <Button
              variant="primary"
              size="lg"
              width="100%"
              label={`Перенести на ${slot.local_start}`}
              isLoading={move.isPending}
              onClick={() => move.mutate(slot)}
            />
          </VStack>
        )}
      </VStack>
    </BottomSheet>
  );
}

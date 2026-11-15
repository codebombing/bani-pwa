import { Banner } from "@astryxdesign/core/Banner";
import { BottomSheet } from "@astryxdesign/core/BottomSheet";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton";
import { VStack } from "@astryxdesign/core/VStack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import {
  formatDuration,
  formatRangeInTz,
  formatRub,
  formatRuPhoneInput,
  normalizeRuPhone,
} from "../../shared/format";
import { ownerApi, ownerErrorMessage, type OwnerHall } from "./ownerApi";
import { ownerKey, refreshOwnerData, useOwner } from "./ownerContext";

type Source = "phone" | "messenger" | "walk_in";

/**
 * Быстрая бронь владельца: зал, время и минимальная длительность уже подставлены —
 * второе нажатие «Сохранить» создаёт бронь. Имя и телефон необязательны.
 */
export function QuickBookingSheet({
  hall,
  startAt,
  onClose,
}: {
  hall: OwnerHall;
  startAt: string;
  onClose: () => void;
}) {
  const { tenant } = useOwner();
  const queryClient = useQueryClient();
  const [duration, setDuration] = useState(hall.min_duration_min);
  const [guests, setGuests] = useState(Math.min(2, hall.capacity_max));
  const [source, setSource] = useState<Source>("phone");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const idempotencyKey = useRef(crypto.randomUUID());

  const endAt = new Date(new Date(startAt).getTime() + duration * 60_000).toISOString();
  const quote = useQuery({
    queryKey: ownerKey(tenant.id, "quote", hall.id, startAt, duration, guests),
    queryFn: () => ownerApi.quote(tenant.slug, hall.id, startAt, duration, guests),
    retry: false,
  });

  const phoneValue = phone.trim() === "" ? null : normalizeRuPhone(phone);
  const phoneInvalid = phone.trim() !== "" && phoneValue === null;

  const save = useMutation({
    mutationFn: () =>
      ownerApi.quickBooking({
        tenantId: tenant.id,
        hallId: hall.id,
        startAt,
        durationMin: duration,
        guests,
        name: name.trim() || "Гость",
        phone: phoneValue,
        source,
        comment: null,
        idempotencyKey: idempotencyKey.current,
      }),
    onSuccess: async () => {
      await refreshOwnerData(queryClient, tenant.id);
      onClose();
    },
    onError: () => {
      idempotencyKey.current = crypto.randomUUID();
    },
  });

  const durations = Array.from(
    { length: 5 },
    (_, i) => hall.min_duration_min + i * hall.slot_step_min,
  );

  return (
    <BottomSheet
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      label="Быстрая бронь"
      height="tall"
      purpose="form"
    >
      <VStack gap={4}>
        <HStack justify="between" vAlign="center">
          <Text color="secondary">Быстрая бронь</Text>
          <Button variant="ghost" size="sm" label="Закрыть" onClick={onClose} />
        </HStack>
        <VStack gap={1}>
          <Heading level={2}>{hall.name}</Heading>
          <Text>{formatRangeInTz(startAt, endAt, tenant.timezone)}</Text>
        </VStack>

        <ToggleButtonGroup
          label="Длительность"
          type="single"
          value={String(duration)}
          onChange={(v) => {
            if (typeof v === "string") setDuration(Number(v));
          }}
        >
          {durations.map((d) => (
            <ToggleButton key={d} value={String(d)} label={formatDuration(d)} />
          ))}
        </ToggleButtonGroup>

        <SegmentedControl
          label="Источник брони"
          layout="fill"
          value={source}
          onChange={(v) => setSource(v as Source)}
        >
          <SegmentedControlItem value="phone" label="Телефон" />
          <SegmentedControlItem value="messenger" label="Мессенджер" />
          <SegmentedControlItem value="walk_in" label="На месте" />
        </SegmentedControl>

        <NumberInput
          label="Гостей"
          value={guests}
          min={1}
          max={hall.capacity_max}
          step={1}
          description={`Включено ${hall.capacity_included}, максимум ${hall.capacity_max}`}
          onChange={(n) => setGuests(Math.max(1, Math.min(hall.capacity_max, Math.round(n))))}
        />
        <TextInput label="Имя" value={name} isOptional placeholder="Гость" onChange={setName} />
        <TextInput
          label="Телефон"
          type="tel"
          value={phone}
          isOptional
          placeholder="+7 900 000-00-00"
          onChange={(v) => setPhone(formatRuPhoneInput(v))}
          status={
            phoneInvalid ? { type: "error", message: "Номер из 10 цифр после +7" } : undefined
          }
        />

        <HStack justify="between" vAlign="center">
          <Text weight="semibold">Итого</Text>
          {quote.data ? (
            <Text weight="semibold" hasTabularNumbers>
              {formatRub(quote.data.total)}
            </Text>
          ) : quote.isError ? (
            <Text color="secondary">—</Text>
          ) : (
            <Skeleton width={96} height={24} />
          )}
        </HStack>
        {quote.data && !quote.data.available && (
          <Banner
            status="warning"
            title="Пересекается с другой бронью или уборкой"
            description="Уменьшите длительность."
          />
        )}
        {quote.isError && (
          <Banner
            status="error"
            title="Так забронировать нельзя"
            description={ownerErrorMessage(quote.error)}
          />
        )}
        {save.isError && (
          <Banner
            status="error"
            title="Бронь не сохранена"
            description={ownerErrorMessage(save.error)}
          />
        )}

        <Button
          variant="primary"
          size="lg"
          width="100%"
          label="Сохранить бронь"
          isLoading={save.isPending}
          isDisabled={phoneInvalid || quote.isError}
          onClick={() => save.mutate()}
        />
      </VStack>
    </BottomSheet>
  );
}

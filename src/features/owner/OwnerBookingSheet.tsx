import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Banner } from "@astryxdesign/core/Banner";
import { BottomSheet } from "@astryxdesign/core/BottomSheet";
import { Button } from "@astryxdesign/core/Button";
import { Calendar, type ISODateString } from "@astryxdesign/core/Calendar";
import { Divider } from "@astryxdesign/core/Divider";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Item } from "@astryxdesign/core/Item";
import { Link } from "@astryxdesign/core/Link";
import { List } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { dateInTz, formatRangeInTz, formatRub, todayInTz } from "../../shared/format";
import { PriceLines } from "../booking/PriceLines";
import { ownerApi, ownerErrorMessage, type OwnerBooking } from "./ownerApi";
import { ownerKey, refreshOwnerData, useOwner } from "./ownerContext";
import { bookingKind, guestsLabel, SOURCE_LABEL } from "./labels";
import { TrashIcon } from "./icons";

/** Детали брони; предстоящую можно перенести, отменить или удалить, прошедшая — только просмотр. */
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
  const isActive =
    (b.status === "confirmed" || b.status === "pending") && bookingKind(b) !== "past";
  const duration = Math.round(
    (new Date(b.end_at).getTime() - new Date(b.start_at).getTime()) / 60_000,
  );

  const [moving, setMoving] = useState(false);
  const [moveDate, setMoveDate] = useState(dateInTz(b.start_at, tz));
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = () => refreshOwnerData(queryClient, tenant.id);

  const seen = useMutation({ mutationFn: () => ownerApi.markSeen(b.id), onSuccess: refresh });
  const markSeen = seen.mutate;
  // Открыли новую бронь — она больше не «новая».
  useEffect(() => {
    if (!b.seen_at) markSeen();
  }, [b.seen_at, markSeen]);
  const remove = useMutation({
    mutationFn: () => ownerApi.deleteBooking(b.id),
    onSuccess: async () => {
      await refresh();
      setConfirmDelete(false);
      onClose();
    },
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
    queryKey: ownerKey(tenant.id, "move", b.id, moveDate, duration),
    queryFn: () => ownerApi.availability(tenant.slug, b.hall_id, moveDate, duration),
    enabled: moving && halls.some((h) => h.id === b.hall_id),
  });

  const actionError = move.error ?? cancel.error ?? remove.error;

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
          <Text color="secondary">{isActive ? hallName : `${hallName} · прошла`}</Text>
          <HStack gap={1} vAlign="center">
            {isActive && (
              <IconButton
                variant="ghost"
                label="Удалить бронь"
                tooltip="Удалить бронь"
                icon={<Icon icon={TrashIcon} />}
                onClick={() => setConfirmDelete(true)}
              />
            )}
            <Button variant="ghost" size="sm" label="Закрыть" onClick={onClose} />
          </HStack>
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
              "не указан"
            )}
          </MetadataListItem>
          <MetadataListItem label="Источник">{SOURCE_LABEL[b.source]}</MetadataListItem>
          {b.comment && <MetadataListItem label="Комментарий">{b.comment}</MetadataListItem>}
        </MetadataList>

        <PriceLines snapshot={b.price_snapshot} total={b.total_amount} />

        {actionError && (
          <Banner
            status="error"
            title="Не получилось"
            description={ownerErrorMessage(actionError)}
          />
        )}

        {isActive && (
          <Button variant="secondary" label="Перенести" onClick={() => setMoving((m) => !m)} />
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
                if (typeof v === "string") setMoveDate(v);
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
                {slots.data.closed ? "В этот день закрыто" : "Свободного времени нет"}
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
      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Удалить бронь навсегда?"
        description={`${b.customer_name}, ${formatRangeInTz(b.start_at, b.end_at, tz)}. Бронь пропадёт из списка и графика. Вернуть будет нельзя.`}
        actionLabel="Удалить"
        cancelLabel="Не удалять"
        isActionLoading={remove.isPending}
        onAction={() => remove.mutate()}
      />
    </BottomSheet>
  );
}

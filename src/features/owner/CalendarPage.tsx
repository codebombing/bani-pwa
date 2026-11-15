import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Item } from "@astryxdesign/core/Item";
import { List } from "@astryxdesign/core/List";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";

import {
  addDays,
  formatDateLong,
  formatRub,
  formatTimeInTz,
  todayInTz,
  zonedDayRange,
} from "../../shared/format";
import { OwnerBookingSheet } from "./OwnerBookingSheet";
import { ownerApi, ownerErrorMessage, paidAmount, type OwnerHall } from "./ownerApi";
import { ownerKey, useOwner } from "./ownerContext";
import { QuickBookingSheet } from "./QuickBookingSheet";
import { guestsLabel, STATUS_LABEL, STATUS_VARIANT } from "./labels";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Календарь дня по залам: брони, блокировки и свободные моменты начала (тап → быстрая бронь). */
export function CalendarPage() {
  const { tenant, halls } = useOwner();
  const tz = tenant.timezone;
  const today = todayInTz(tz);
  const [params, setParams] = useSearchParams();
  const raw = params.get("d");
  const date = raw && DATE_RE.test(raw) ? raw : today;
  const setDate = (d: string) => setParams(d === today ? {} : { d });
  const range = zonedDayRange(date, tz);

  const [quick, setQuick] = useState<{ hall: OwnerHall; startAt: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const bookings = useQuery({
    queryKey: ownerKey(tenant.id, "day", date, "bookings"),
    queryFn: () => ownerApi.bookings(tenant.id, range.from, range.to),
  });
  const blocks = useQuery({
    queryKey: ownerKey(tenant.id, "day", date, "blocks"),
    queryFn: () => ownerApi.blocks(tenant.id, range.from, range.to),
  });
  const free = useQueries({
    queries: halls.map((h) => ({
      queryKey: ownerKey(tenant.id, "day", date, "free", h.id),
      queryFn: () => ownerApi.availability(tenant.slug, h.id, date, h.min_duration_min),
    })),
  });

  const opened = bookings.data?.find((b) => b.id === openId) ?? null;
  const loading = bookings.isPending || blocks.isPending;
  const error = bookings.error ?? blocks.error;

  return (
    <VStack as="main" padding={4} gap={4} maxWidth={720}>
      <HStack justify="between" vAlign="center" gap={2}>
        <Button
          variant="ghost"
          label="Предыдущий день"
          isIconOnly
          icon={<Icon icon="chevronLeft" />}
          onClick={() => setDate(addDays(date, -1))}
        />
        <VStack gap={0.5} hAlign="center">
          <Heading level={1}>{date === today ? "Сегодня" : formatDateLong(date)}</Heading>
          {date === today && <Text color="secondary">{formatDateLong(date)}</Text>}
        </VStack>
        <Button
          variant="ghost"
          label="Следующий день"
          isIconOnly
          icon={<Icon icon="chevronRight" />}
          onClick={() => setDate(addDays(date, 1))}
        />
      </HStack>
      {date !== today && (
        <Button
          variant="secondary"
          size="sm"
          label="К сегодняшнему дню"
          onClick={() => setDate(today)}
        />
      )}

      {error && (
        <Banner
          status="error"
          title="Не удалось загрузить календарь"
          description={ownerErrorMessage(error)}
          endContent={
            <Button
              label="Повторить"
              onClick={() => {
                void bookings.refetch();
                void blocks.refetch();
              }}
            />
          }
        />
      )}

      {halls.map((hall, i) => {
        const hallBookings = (bookings.data ?? []).filter((b) => b.hall_id === hall.id);
        const hallBlocks = (blocks.data ?? []).filter((b) => b.hallId === hall.id);
        const slots = free[i]?.data?.slots ?? [];
        const closed = free[i]?.data?.closed === true;
        return (
          <Card key={hall.id} padding={4}>
            <VStack gap={3}>
              <Heading level={2}>{hall.name}</Heading>

              {loading ? (
                <Skeleton height={56} />
              ) : hallBookings.length === 0 && hallBlocks.length === 0 ? (
                <Text color="secondary">Броней нет</Text>
              ) : (
                <List hasDividers>
                  {hallBookings.map((b) => {
                    const paid = paidAmount(b);
                    return (
                      <Item
                        key={b.id}
                        label={`${formatTimeInTz(b.start_at, tz)}–${formatTimeInTz(b.end_at, tz)} · ${b.customer_name}`}
                        description={`${guestsLabel(b.guests)} · ${formatRub(b.total_amount)}${
                          paid > 0 ? ` · оплачено ${formatRub(paid)}` : ""
                        }`}
                        startContent={
                          <StatusDot
                            variant={STATUS_VARIANT[b.status]}
                            label={STATUS_LABEL[b.status]}
                          />
                        }
                        endContent={<Text color="secondary">{STATUS_LABEL[b.status]}</Text>}
                        onClick={() => setOpenId(b.id)}
                      />
                    );
                  })}
                  {hallBlocks.map((bl) => (
                    <Item
                      key={bl.occupancyId}
                      label={`${formatTimeInTz(bl.from, tz)}–${formatTimeInTz(bl.to, tz)} · закрыто`}
                      description={bl.reason}
                      startContent={<StatusDot variant="neutral" label="Блокировка" />}
                    />
                  ))}
                </List>
              )}

              <VStack gap={2}>
                <Text weight="semibold">Свободно — нажмите время, чтобы записать гостя</Text>
                {free[i]?.isPending ? (
                  <Skeleton height={36} />
                ) : closed ? (
                  <Text color="secondary">В этот день закрыто</Text>
                ) : slots.length === 0 ? (
                  <Text color="secondary">Свободного времени нет</Text>
                ) : (
                  <HStack gap={2} wrap="wrap">
                    {slots.map((s) => (
                      <Button
                        key={s.start_at}
                        size="sm"
                        variant="secondary"
                        label={s.local_start}
                        onClick={() => setQuick({ hall, startAt: s.start_at })}
                      />
                    ))}
                  </HStack>
                )}
              </VStack>
            </VStack>
          </Card>
        );
      })}

      {quick && (
        <QuickBookingSheet
          hall={quick.hall}
          startAt={quick.startAt}
          onClose={() => setQuick(null)}
        />
      )}
      {opened && (
        <OwnerBookingSheet
          booking={opened}
          hallName={halls.find((h) => h.id === opened.hall_id)?.name ?? "Зал"}
          onClose={() => setOpenId(null)}
        />
      )}
    </VStack>
  );
}

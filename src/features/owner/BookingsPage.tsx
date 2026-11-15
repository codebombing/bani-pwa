import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Item } from "@astryxdesign/core/Item";
import { List } from "@astryxdesign/core/List";
import { Selector } from "@astryxdesign/core/Selector";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { dateInTz, formatDateLong, formatRub, formatTimeInTz } from "../../shared/format";
import { OwnerBookingSheet } from "./OwnerBookingSheet";
import { ownerApi, ownerErrorMessage, paidAmount, type OwnerBooking } from "./ownerApi";
import { ownerKey, useOwner } from "./ownerContext";
import { FilterIcon } from "./icons";
import { guestsLabel, STATUS_LABEL, STATUS_VARIANT } from "./labels";

type Filter = "all" | "new" | OwnerBooking["status"];
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "new", label: "Новые" },
  { value: "confirmed", label: "Ожидаем" },
  { value: "completed", label: "Пришли" },
  { value: "no_show", label: "Не пришли" },
  { value: "cancelled", label: "Отменённые" },
];
const DAY = 86_400_000;

/** Все брони одним списком (новые даты сверху), по дням; фильтр по статусу — по кнопке. */
export function BookingsPage() {
  const { tenant, halls } = useOwner();
  const tz = tenant.timezone;
  const [filter, setFilter] = useState<Filter>("all");
  const [showFilter, setShowFilter] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ownerKey(tenant.id, "list"),
    queryFn: () => {
      const now = Date.now();
      return ownerApi.bookings(tenant.id, new Date(now - 90 * DAY), new Date(now + 120 * DAY), {
        includeCancelled: true,
        ascending: false,
      });
    },
  });
  const shown = useMemo(
    () =>
      (list.data ?? []).filter((b) =>
        filter === "all"
          ? true
          : filter === "new"
            ? !b.seen_at
            : filter === "confirmed"
              ? b.status === "confirmed" || b.status === "pending"
              : b.status === filter,
      ),
    [list.data, filter],
  );

  const groups = useMemo(() => {
    const map = new Map<string, OwnerBooking[]>();
    for (const b of shown) {
      const day = dateInTz(b.start_at, tz);
      map.set(day, [...(map.get(day) ?? []), b]);
    }
    return [...map.entries()];
  }, [shown, tz]);

  const opened = list.data?.find((b) => b.id === openId) ?? null;
  const hallName = (id: string) => halls.find((h) => h.id === id)?.name ?? "Зал";

  return (
    <VStack as="main" padding={4} gap={4} maxWidth={720}>
      <HStack justify="between" vAlign="center">
        <Heading level={1}>Брони</Heading>
        <IconButton
          variant={filter === "all" ? "ghost" : "secondary"}
          label="Фильтр по статусу"
          tooltip="Фильтр по статусу"
          icon={<Icon icon={FilterIcon} />}
          onClick={() => setShowFilter((v) => !v)}
        />
      </HStack>
      {showFilter && (
        <Selector
          label="Показать"
          value={filter}
          options={FILTERS}
          onChange={(v) => setFilter(v as Filter)}
        />
      )}

      {list.isPending && (
        <VStack gap={2}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={56} index={i} />
          ))}
        </VStack>
      )}
      {list.isError && (
        <Banner
          status="error"
          title="Не удалось загрузить брони"
          description={ownerErrorMessage(list.error)}
          endContent={<Button label="Повторить" onClick={() => void list.refetch()} />}
        />
      )}
      {list.isSuccess && groups.length === 0 && (
        <EmptyState
          title={filter === "all" ? "Броней пока нет" : "Таких броней нет"}
          description={filter === "all" ? "Новые брони появятся здесь и в графике." : undefined}
        />
      )}
      {groups.map(([day, items]) => (
        <VStack key={day} gap={1}>
          <Text weight="semibold">{formatDateLong(day)}</Text>
          <List hasDividers>
            {items.map((b) => {
              const paid = paidAmount(b);
              return (
                <Item
                  key={b.id}
                  label={`${formatTimeInTz(b.start_at, tz)}–${formatTimeInTz(b.end_at, tz)} · ${b.customer_name}`}
                  description={`${hallName(b.hall_id)} · ${guestsLabel(b.guests)} · ${formatRub(b.total_amount)}${
                    paid > 0 ? ` · оплачено ${formatRub(paid)}` : ""
                  }`}
                  startContent={
                    <StatusDot variant={STATUS_VARIANT[b.status]} label={STATUS_LABEL[b.status]} />
                  }
                  endContent={
                    b.seen_at ? (
                      <Text color="secondary">{STATUS_LABEL[b.status]}</Text>
                    ) : (
                      <Text weight="semibold" color="accent">
                        новая
                      </Text>
                    )
                  }
                  onClick={() => setOpenId(b.id)}
                />
              );
            })}
          </List>
        </VStack>
      ))}

      {opened && (
        <OwnerBookingSheet
          booking={opened}
          hallName={hallName(opened.hall_id)}
          onClose={() => setOpenId(null)}
        />
      )}
    </VStack>
  );
}

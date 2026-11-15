-- Задаток больше не используется: о нём владелец договаривается с гостем по телефону.
-- Триггер tenants_effective_deposit обнулит deposit_percent — гости, расчёт цены и бот
-- задаток не видят. Колонки и функции оставлены, чтобы не ломать историю платежей.
alter table public.tenants alter column deposit_enabled set default false;
update public.tenants set deposit_enabled = false where deposit_enabled;

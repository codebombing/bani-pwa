/**
 * Сквозной сценарий: гость бронирует (без задатка) → владелец входит → видит новую бронь →
 * открывает (больше не новая; денег и статусов визита нет) → отменяет — бронь пропадает.
 * Временное заведение публикуется той же функцией, что tenant:publish, и удаляется в конце.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { connect } from "../integration/db";
import { adminClient } from "../integration/http";

const slug = `e2e-${randomUUID().slice(0, 8)}`;
const email = `owner-${slug}@e2e.test`;
const admin = adminClient();
let tenantId = "";
let userId = "";

function moscowDate(daysAhead: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(
    new Date(Date.now() + daysAhead * 86_400_000),
  );
}

/** Текст страницы с обычными пробелами (Intl форматирует суммы с неразрывными). */
const pageText = async (page: Page) =>
  (await page.locator("body").innerText()).replace(/\s+/g, " ");
const norm = (s: string) => s.replace(/\s+/g, " ");

test.beforeAll(async () => {
  const config = JSON.parse(readFileSync("tenants/demo-sauna24/business.json", "utf8")) as Record<
    string,
    unknown
  >;
  config.slug = slug;
  config.name = "E2E-сауна";
  const { data, error } = await admin.rpc("admin_publish_tenant", {
    p_config: config,
    p_config_hash: randomUUID().replace(/-/g, "").repeat(2),
    p_live: false,
    p_published_by: "e2e",
  });
  if (error) throw error;
  tenantId = (data as { tenant_id: string }).tenant_id;

  const user = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (user.error || !user.data.user) throw user.error ?? new Error("user");
  userId = user.data.user.id;
  const { error: memberError } = await admin
    .from("tenant_members")
    .insert({ tenant_id: tenantId, user_id: userId, role: "owner" });
  if (memberError) throw memberError;
});

test.afterAll(async () => {
  const db = await connect();
  await db.query("delete from public.bookings where tenant_id = $1", [tenantId]);
  await db.query("delete from public.tenants where id = $1", [tenantId]);
  await db.end();
  if (userId) await admin.auth.admin.deleteUser(userId);
});

test("гость бронирует, владелец видит новую бронь и отменяет её", async ({ page }) => {
  // ---------- Гость ----------
  await page.goto(`/s/${slug}/`);
  await expect(page.getByRole("heading", { level: 1, name: "E2E-сауна" })).toBeVisible();
  await page.getByRole("button", { name: "Забронировать", exact: true }).click();

  const step = page.getByRole("heading", { name: /Выберите (зал|дату)/ }).last();
  await expect(step).toBeVisible();
  if ((await step.textContent()) === "Выберите зал") {
    await page.getByRole("dialog").getByText("Сауна с бассейном", { exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Выберите дату" }).last()).toBeVisible();

  // Через 3 дня — может быть уже следующий месяц.
  const day = page.locator(`button[data-date="${moscowDate(3)}"]`);
  if ((await day.count()) === 0) {
    await page
      .getByRole("button", { name: /следующ/i })
      .first()
      .click();
  }
  await day.click();

  await expect(page.getByRole("heading", { name: "Время и длительность" })).toBeVisible();
  await page.getByRole("button", { name: "20:00–22:00" }).click();

  await expect(page.getByRole("heading", { name: "Гости и допы" })).toBeVisible();
  await page.getByRole("button", { name: "Далее" }).click();

  await expect(page.getByRole("heading", { name: "Контакты" }).last()).toBeVisible();
  await page.getByLabel("Имя").fill("E2E Гость");
  await page.getByLabel("Телефон").fill("9001112233");
  await page.getByLabel("Согласен на обработку персональных данных").check();
  await page.getByRole("button", { name: "Далее" }).click();

  await expect(page.getByRole("heading", { name: "Проверьте бронь" })).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить бронь" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Бронь подтверждена" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Добавить в календарь" })).toBeVisible();

  const db = await connect();
  const { rows } = await db.query<{ deposit: string }>(
    `select (price_snapshot ->> 'deposit_amount') as deposit
     from public.bookings where tenant_id = $1`,
    [tenantId],
  );
  await db.end();
  expect(rows).toHaveLength(1);
  expect(Number(rows[0]?.deposit)).toBe(0);

  // ---------- Владелец ----------
  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `http://localhost:5173/s/${slug}/owner/` },
  });
  if (link.error) throw link.error;
  await page.goto(link.data.properties.action_link);
  // Онлайн-бронь ещё не открывали — на «Бронях» красная точка, в меню нет «Отчёта».
  await expect(page.getByRole("button", { name: "Брони, есть новые" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Отчёт" })).toHaveCount(0);
  await page
    .getByText(/E2E Гость/)
    .first()
    .click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "E2E Гость" })).toBeVisible();
  await expect(sheet.getByText("Деньги")).toHaveCount(0);
  await expect(sheet.getByText("Пришли")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Брони", exact: true })).toBeVisible();

  await sheet.getByRole("button", { name: "Отменить бронь" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Отменить бронь" }).click();
  await expect(page.getByText(/E2E Гость/)).toHaveCount(0);
  await expect.poll(async () => pageText(page)).toContain(norm("Броней пока нет"));
});

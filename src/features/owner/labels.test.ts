import { describe, expect, it } from "vitest";

import { bookingKind } from "./labels";

const now = Date.parse("2026-11-15T12:00:00Z");
const b = (end_at: string, seen_at: string | null, status = "confirmed" as const) => ({
  end_at,
  seen_at,
  status,
});

describe("bookingKind", () => {
  it("непросмотренная будущая — новая", () => {
    expect(bookingKind(b("2026-11-16T12:00:00Z", null), now)).toBe("new");
  });
  it("просмотренная будущая — предстоит", () => {
    expect(bookingKind(b("2026-11-16T12:00:00Z", "2026-11-15T10:00:00Z"), now)).toBe("upcoming");
  });
  it("закончилась — прошла, даже если не открывали", () => {
    expect(bookingKind(b("2026-11-15T12:00:00Z", null), now)).toBe("past");
  });
});

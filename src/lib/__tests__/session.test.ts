/**
 * Session-window resolution: the app must display real historical data outside
 * market hours (weekends, after the close, holidays) instead of showing
 * nothing — always fetched from Upstox, never generated.
 */
import { describe, expect, it } from "vitest";
import { istDateStr, marketPhase, previousWeekdayIST, resolveSessionWindow, shiftISTDate } from "../math";

describe("resolveSessionWindow", () => {
  it("streams today's session while the exchange is trading", () => {
    const ts = Date.parse("2026-11-18T10:30:00+05:30"); // Wednesday 10:30 IST
    expect(marketPhase(ts)).toBe("OPEN");
    const w = resolveSessionWindow(ts);
    expect(w.live).toBe(true);
    expect(w.mode).toBe("OPEN");
    expect(w.sessionDate).toBe("2026-11-18");
    expect(w.from).toBe("2026-11-18");
  });

  it("reads today's completed session after the weekday close", () => {
    const ts = Date.parse("2026-11-18T16:00:00+05:30"); // Wednesday 16:00 IST
    expect(marketPhase(ts)).toBe("CLOSED");
    const w = resolveSessionWindow(ts);
    expect(w.live).toBe(false);
    expect(w.mode).toBe("HISTORICAL");
    expect(w.sessionDate).toBe("2026-11-18");
  });

  it("rolls back to Friday on a Saturday", () => {
    const ts = Date.parse("2026-11-21T12:00:00+05:30"); // Saturday
    expect(marketPhase(ts)).toBe("HOLIDAY");
    const w = resolveSessionWindow(ts);
    expect(w.live).toBe(false);
    expect(w.sessionDate).toBe("2026-11-20");
    expect(w.from).toBe("2026-11-20");
    expect(w.to).toBe("2026-11-20");
  });

  it("uses the previous weekday before the open", () => {
    const ts = Date.parse("2026-11-18T07:30:00+05:30"); // Wednesday 07:30 IST
    const w = resolveSessionWindow(ts);
    expect(w.live).toBe(false);
    expect(w.sessionDate).toBe("2026-11-17"); // Tuesday
  });

  it("keeps exchange calendar arithmetic in IST", () => {
    expect(previousWeekdayIST("2026-11-21")).toBe("2026-11-20");
    expect(previousWeekdayIST("2026-11-23")).toBe("2026-11-20");
    expect(shiftISTDate("2026-11-21", -1)).toBe("2026-11-20");
    expect(istDateStr(Date.parse("2026-11-21T23:59:00+05:30"))).toBe("2026-11-21");
    expect(istDateStr(Date.parse("2026-11-21T18:30:00+00:00"))).toBe("2026-11-22"); // 00:00 IST next day
  });
});

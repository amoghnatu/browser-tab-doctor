import { describe, expect, it } from "vitest";
import {
  evaluateProactiveNotification,
  isLongIdleForNotify,
  notificationMessage,
} from "../src/lib/notify";
import { DEFAULT_CONFIG, type Config, type TabRecord } from "../src/types";
import { MS_PER_DAY } from "../src/lib/date";

function tab(
  partial: Partial<TabRecord> & Pick<TabRecord, "key">,
): TabRecord {
  return {
    tabId: 1,
    windowId: 1,
    index: 0,
    url: "https://example.com/",
    title: "Ex",
    pinned: false,
    discarded: false,
    firstOpenedAt: Date.UTC(2026, 0, 1),
    lastActiveAt: Date.UTC(2026, 0, 1),
    lastSeenAt: Date.UTC(2026, 0, 1),
    isOpen: true,
    ...partial,
  };
}

const now = Date.UTC(2026, 6, 12, 12); // July 12, 2026
const cfg: Config = { ...DEFAULT_CONFIG };

describe("isLongIdleForNotify", () => {
  it("treats unknown lastActiveAt as long-idle", () => {
    expect(isLongIdleForNotify(tab({ key: "u", lastActiveAt: null }), 15, now)).toBe(true);
    expect(isLongIdleForNotify(tab({ key: "z", lastActiveAt: 0 }), 15, now)).toBe(true);
  });

  it("uses notifyLongIdleDays threshold", () => {
    const old = tab({ key: "a", lastActiveAt: now - 15 * MS_PER_DAY });
    const young = tab({ key: "b", lastActiveAt: now - 14 * MS_PER_DAY });
    expect(isLongIdleForNotify(old, 15, now)).toBe(true);
    expect(isLongIdleForNotify(young, 15, now)).toBe(false);
  });
});

describe("evaluateProactiveNotification (R12)", () => {
  /** 20 open tabs, 7 of them long-idle (35%) */
  function twentyWithShare(longIdle: number, total = 20): TabRecord[] {
    const rows: TabRecord[] = [];
    for (let i = 0; i < total; i++) {
      const isLong = i < longIdle;
      rows.push(
        tab({
          key: `k${i}`,
          tabId: i + 1,
          lastActiveAt: isLong ? now - 20 * MS_PER_DAY : now - 2 * MS_PER_DAY,
        }),
      );
    }
    return rows;
  }

  it("notifies at defaults: ≥20 open and ≥35% idle ≥15d, no cooldown", () => {
    // 7/20 = 35%
    const open = twentyWithShare(7, 20);
    const d = evaluateProactiveNotification(open, cfg, null, now);
    expect(d.shouldNotify).toBe(true);
    expect(d.reason).toBe("ok");
    expect(d.openCount).toBe(20);
    expect(d.longIdleCount).toBe(7);
    expect(d.sharePercent).toBe(35);
  });

  it("rejects too few open tabs", () => {
    const open = twentyWithShare(10, 19);
    const d = evaluateProactiveNotification(open, cfg, null, now);
    expect(d.shouldNotify).toBe(false);
    expect(d.reason).toBe("too_few_tabs");
  });

  it("rejects share just under 35%", () => {
    // 6/20 = 30%
    const open = twentyWithShare(6, 20);
    const d = evaluateProactiveNotification(open, cfg, null, now);
    expect(d.shouldNotify).toBe(false);
    expect(d.reason).toBe("share_too_low");
  });

  it("respects cooldown of 7 days", () => {
    const open = twentyWithShare(10, 20);
    const sixDaysAgo = now - 6 * MS_PER_DAY;
    const d = evaluateProactiveNotification(open, cfg, sixDaysAgo, now);
    expect(d.shouldNotify).toBe(false);
    expect(d.reason).toBe("cooldown");

    const sevenDaysAgo = now - 7 * MS_PER_DAY;
    const d2 = evaluateProactiveNotification(open, cfg, sevenDaysAgo, now);
    expect(d2.shouldNotify).toBe(true);
  });

  it("respects master switch off", () => {
    const open = twentyWithShare(10, 20);
    const d = evaluateProactiveNotification(
      open,
      { ...cfg, notificationsEnabled: false },
      null,
      now,
    );
    expect(d.shouldNotify).toBe(false);
    expect(d.reason).toBe("disabled");
  });

  it("counts unknown last-used toward long-idle share", () => {
    const open: TabRecord[] = [];
    for (let i = 0; i < 20; i++) {
      open.push(
        tab({
          key: `k${i}`,
          tabId: i + 1,
          // 7 unknown → 35%
          lastActiveAt: i < 7 ? null : now - MS_PER_DAY,
        }),
      );
    }
    const d = evaluateProactiveNotification(open, cfg, null, now);
    expect(d.longIdleCount).toBe(7);
    expect(d.shouldNotify).toBe(true);
  });

  it("builds a clear notification message", () => {
    const msg = notificationMessage(
      {
        shouldNotify: true,
        openCount: 40,
        longIdleCount: 14,
        sharePercent: 35,
        reason: "ok",
      },
      15,
    );
    expect(msg).toContain("14 of 40");
    expect(msg).toContain("15");
  });
});

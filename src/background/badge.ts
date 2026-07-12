import type Browser from "webextension-polyfill";
import type { Config } from "../types";
import { badgeTextForCount } from "../lib/staleness";
import * as logger from "../lib/logger";

const BADGE_COLOR = "#C0392B";

export async function refreshBadge(
  browserApi: typeof Browser,
  cfg: Config,
  staleCount: number,
): Promise<void> {
  try {
    if (!cfg.badgeEnabled || staleCount === 0) {
      await browserApi.action.setBadgeText({ text: "" });
      await browserApi.action.setTitle({ title: "Browser Tab Doctor" });
      return;
    }
    await browserApi.action.setBadgeText({ text: badgeTextForCount(staleCount) });
    await browserApi.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    await browserApi.action.setTitle({
      title: `${staleCount} tab(s) idle > ${cfg.thresholdDays} days`,
    });
  } catch (e) {
    logger.error("refreshBadge failed", e);
  }
}

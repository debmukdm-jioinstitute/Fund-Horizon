import type { DrawdownEpisode, FundNavPoint } from "@/lib/types";

/**
 * Computes consecutive underwater/drawdown episodes from a chronological NAV series.
 */
export function computeDrawdownEpisodes(navs: FundNavPoint[]): DrawdownEpisode[] {
  if (!navs || navs.length < 2) return [];

  let runningMax = 0;
  let peakDate = "";
  let peakNav = 0;
  let curStreak = 0;
  let startDate = "";
  let troughDate = "";
  let troughNav = 0;
  let minDrop = 0;
  const episodes: DrawdownEpisode[] = [];

  for (const p of navs) {
    if (p.nav >= runningMax) {
      if (curStreak > 0) {
        episodes.push({
          peak_date: peakDate,
          peak_nav: Number(peakNav.toFixed(2)),
          start_date: startDate,
          trough_date: troughDate,
          trough_nav: Number(troughNav.toFixed(2)),
          recovery_date: p.date,
          recovery_nav: Number(p.nav.toFixed(2)),
          max_drop: minDrop,
          months: curStreak,
          recovered: true,
        });
        curStreak = 0;
      }
      runningMax = p.nav;
      peakDate = p.date;
      peakNav = p.nav;
    } else {
      const drop = (p.nav - runningMax) / runningMax;
      if (curStreak === 0) {
        startDate = p.date;
        troughDate = p.date;
        troughNav = p.nav;
        minDrop = drop;
      } else if (drop < minDrop) {
        minDrop = drop;
        troughDate = p.date;
        troughNav = p.nav;
      }
      curStreak++;
    }
  }

  if (curStreak > 0) {
    episodes.push({
      peak_date: peakDate,
      peak_nav: Number(peakNav.toFixed(2)),
      start_date: startDate,
      trough_date: troughDate,
      trough_nav: Number(troughNav.toFixed(2)),
      recovery_date: null,
      recovery_nav: null,
      max_drop: minDrop,
      months: curStreak,
      recovered: false,
    });
  }

  return episodes;
}

import type { FertigationRecipe } from '@spff/contracts';

export function jakartaDay(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (key: string) => parts.find(value => value.type === key)?.value ?? '';
  return [part('year'), part('month'), part('day')].join('-');
}

export function calculateHst(plantingDate: string | null, today: string): number | null {
  if (!plantingDate) return null;
  const value = (Date.parse(today + 'T00:00:00Z') - Date.parse(plantingDate + 'T00:00:00Z')) / 86400000;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Repeats from HST start, stops at HST end; never replays missed days. */
export function applicationDue(recipe: FertigationRecipe, today: string): boolean {
  const hst = calculateHst(recipe.plantingDate, today);
  if (hst === null || hst < recipe.hstFrom || hst > recipe.hstTo) return false;
  if (recipe.applicationMode === 'sensor') return true;
  if (recipe.applicationMode === 'interval') {
    const interval = recipe.applicationIntervalDays;
    return interval !== null && Number.isSafeInteger(interval) && interval > 0 &&
      (hst - recipe.hstFrom) % interval === 0;
  }
  return recipe.applicationDate === today;
}

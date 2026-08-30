/** Week math. Weeks start Monday; offsets are relative to the current week (0). */

function mondayOf(offset: number): Date {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  const mon = new Date(now);
  mon.setDate(now.getDate() - dow + offset * 7);
  return mon;
}

/** "Mon 24 Aug" for the Monday of the week at `offset`. */
export function wm(offset: number): string {
  const mon = mondayOf(offset);
  return 'Mon ' + mon.getDate() + ' ' + mon.toLocaleDateString('en-GB', { month: 'short' });
}

/** "Fri 28 Aug" — `add` days after the Monday of the week at `offset`. */
export function dstr(offset: number, add: number): string {
  const d = mondayOf(offset);
  d.setDate(d.getDate() + add);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "Sun 30 Aug" for today. */
export function todayStr(): string {
  return new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

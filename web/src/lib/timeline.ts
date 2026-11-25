import type { VoiceActorDetail, WorkRef } from "./types";

export type Role = NonNullable<VoiceActorDetail["roles"]>[number];

/** 役と作品の組を、作品の開始年ごとにまとめる（新しい年が先、年の分からないものは最後）。 */
export function timelineYears(roles: Role[]) {
  const byYear = new Map<number | null, { role: Role; work: WorkRef }[]>();
  for (const role of roles) {
    for (const work of role.works ?? []) {
      const year = work.year ?? null;
      const list = byYear.get(year) ?? [];
      list.push({ role, work });
      byYear.set(year, list);
    }
  }
  const order = (r: { work: WorkRef }) => (r.work.role === "MAIN" ? 0 : 1);
  return [...byYear.entries()]
    .sort(([a], [b]) => (a == null ? 1 : b == null ? -1 : b - a))
    .map(([year, rows]) => ({ year, rows: rows.sort((x, y) => order(x) - order(y)) }));
}

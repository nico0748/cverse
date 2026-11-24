import { describe, expect, it } from "vitest";
import { timelineYears } from "./timeline";

describe("timelineYears", () => {
  it("groups role–work pairs by year, newest first, with unknown years last and main roles first", () => {
    const years = timelineYears([
      { id: "ch:a", name: "A", works: [{ id: "wk:1", name: "W1", year: 2010, role: "SUPPORTING" }, { id: "wk:2", name: "W2", year: 2020, role: "MAIN" }] },
      { id: "ch:b", name: "B", works: [{ id: "wk:3", name: "W3", year: 2010, role: "MAIN" }, { id: "wk:4", name: "W4" }] },
    ]);
    expect(years.map((y) => y.year)).toEqual([2020, 2010, null]);
    expect(years[1].rows.map((r) => r.role.id)).toEqual(["ch:b", "ch:a"]);
    expect(years[2].rows[0].work.id).toBe("wk:4");
  });

  it("returns nothing for a voice actor without roles", () => {
    expect(timelineYears([])).toEqual([]);
    expect(timelineYears([{ id: "ch:a", name: "A" }])).toEqual([]);
  });
});

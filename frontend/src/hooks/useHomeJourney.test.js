import { describe, expect, it } from "vitest";
import { appendJourneyStop } from "./useHomeJourney";

describe("appendJourneyStop", () => {
  const tokyo = { panoId: "a", lat: 1, lng: 2, label: "日本东京" };

  it("relabels the current stop instead of adding it twice", () => {
    const stops = appendJourneyStop([tokyo], {
      ...tokyo,
      label: "Tokyo, Japan",
    });
    expect(stops).toEqual([{ ...tokyo, label: "Tokyo, Japan" }]);
  });

  it("keeps a revisited stop where it was in the trip", () => {
    const osaka = { panoId: "b", lat: 3, lng: 4, label: "Osaka" };
    const stops = [tokyo, osaka];
    expect(appendJourneyStop(stops, tokyo)).toBe(stops);
    expect(
      appendJourneyStop(stops, { ...tokyo, label: "Tokyo, Japan" }),
    ).toEqual([{ ...tokyo, label: "Tokyo, Japan" }, osaka]);
  });

  it("appends a new stop", () => {
    const osaka = { panoId: "b", lat: 3, lng: 4, label: "Osaka" };
    expect(appendJourneyStop([tokyo], osaka)).toEqual([tokyo, osaka]);
  });
});

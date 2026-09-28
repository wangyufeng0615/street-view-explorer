import { expect, it } from "vitest";
import { clusterFootprints } from "./footprintClusters";

it("groups nearby points in world overview and splits them on zoom", () => {
  const visits = [
    { latitude: 40, longitude: 10 },
    { latitude: 40.01, longitude: 10.01 },
  ];
  expect(clusterFootprints(visits, 2)).toHaveLength(1);
  expect(clusterFootprints(visits, 18)).toHaveLength(2);
  expect(
    clusterFootprints([...visits, { latitude: NaN, longitude: 0 }], 2)[0]
      .visits,
  ).toHaveLength(2);
});

it("gives each group a key that stays stable at the same zoom", () => {
  const visits = [
    { latitude: 40, longitude: 10 },
    { latitude: -33.9, longitude: 151.2 },
  ];
  const first = clusterFootprints(visits, 5).map((group) => group.key);
  const second = clusterFootprints([...visits].reverse(), 5).map(
    (group) => group.key,
  );
  expect(new Set(first)).toEqual(new Set(second));
  expect(first[0]).not.toBe(clusterFootprints(visits, 6)[0].key);
});

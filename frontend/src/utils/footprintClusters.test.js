import { expect, it } from 'vitest';
import { clusterFootprints } from './footprintClusters';

it('groups nearby points in world overview and splits them on zoom', () => {
  const visits = [{ latitude: 40, longitude: 10 }, { latitude: 40.01, longitude: 10.01 }];
  expect(clusterFootprints(visits, 2)).toHaveLength(1);
  expect(clusterFootprints(visits, 18)).toHaveLength(2);
  expect(clusterFootprints([...visits, { latitude: NaN, longitude: 0 }], 2)[0].visits).toHaveLength(2);
});

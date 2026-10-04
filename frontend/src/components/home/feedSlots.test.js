import { describe, expect, it } from "vitest";
import { assignFeedSlots, EMPTY_FEED, PENDING_KEY } from "./feedSlots";

const place = (key) => ({ key, location: { pano_id: key }, label: key });

function assign(steps) {
  return steps.reduce(
    (feed, wanted) => assignFeedSlots(feed, wanted),
    EMPTY_FEED,
  );
}

describe("assignFeedSlots", () => {
  it("turns the prepared next card into the current one after a swipe", () => {
    const a = place("a");
    const b = place("b");
    const before = assign([{ current: a, next: b, prev: null }]);
    const nextSlot = before.roles.next;
    const currentSlot = before.roles.current;

    const after = assignFeedSlots(before, { current: b, next: null, prev: a });

    expect(after.roles.current).toBe(nextSlot);
    expect(after.roles.prev).toBe(currentSlot);
    expect(after.items[nextSlot]).toBe(b);
  });

  it("cycles through three cards without reloading the ones still in use", () => {
    const [a, b, c, d] = ["a", "b", "c", "d"].map(place);
    let feed = assign([
      { current: a, next: b, prev: null },
      { current: b, next: null, prev: a },
      { current: b, next: c, prev: a },
    ]);
    const slotOfC = feed.roles.next;
    const slotOfA = feed.roles.prev;

    feed = assignFeedSlots(feed, { current: c, next: d, prev: b });

    expect(feed.roles.current).toBe(slotOfC);
    // a 已经不再需要，它的卡片拿来装 d
    expect(feed.roles.next).toBe(slotOfA);
    expect(feed.items[slotOfA]).toBe(d);
  });

  it("keeps the old panorama under a pending card and loads the new place there", () => {
    const a = place("a");
    let feed = assign([{ current: a, next: { key: PENDING_KEY }, prev: null }]);
    const pendingSlot = feed.roles.next;
    expect(feed.items[pendingSlot]).toMatchObject({ pending: true });

    // 上滑到空卡片：当前站清空，正在加载
    feed = assignFeedSlots(feed, {
      current: { key: PENDING_KEY },
      next: null,
      prev: a,
    });
    expect(feed.roles.current).toBe(pendingSlot);

    const b = place("b");
    feed = assignFeedSlots(feed, { current: b, next: null, prev: a });
    expect(feed.roles.current).toBe(pendingSlot);
    expect(feed.items[pendingSlot]).toBe(b);
  });

  it("returns the same assignment when nothing changed", () => {
    const a = place("a");
    const feed = assign([{ current: a, next: null, prev: null }]);
    expect(
      assignFeedSlots(feed, { current: { ...a }, next: null, prev: null }),
    ).toBe(feed);
  });
});

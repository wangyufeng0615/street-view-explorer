// 手机首页上下滑动的三张卡片：当前、下一站、上一站。卡片（DOM 和里面的街景实例）
// 固定三张循环使用，滑动后只交换角色，不销毁重建：每新建一个街景实例都算一次计费加载，
// 已经加载好的画面也能直接接着用。

export const FEED_SLOT_COUNT = 3;
export const PENDING_KEY = "pending";

const ROLES = ["current", "next", "prev"];

export const EMPTY_FEED = {
  items: Array(FEED_SLOT_COUNT).fill(null),
  roles: { current: null, next: null, prev: null },
};

function sameItem(a, b) {
  return (
    a?.key === b?.key &&
    a?.location === b?.location &&
    a?.pending === b?.pending &&
    a?.label === b?.label
  );
}

// 还没取到地点的卡片：沿用这张卡片上次的地点，街景实例保持不动，由遮罩盖住
function placeItem(previousItem, item) {
  if (item.key !== PENDING_KEY) return item;
  return { ...item, location: previousItem?.location ?? null, pending: true };
}

/**
 * 给三个角色分配卡片。已经装着同一地点的卡片直接换角色；剩下的角色优先沿用
 * 上次承担同一角色的卡片，再用空闲的卡片。wanted 的每一项是 { key, location } 或 null。
 */
export function assignFeedSlots(previous, wanted) {
  const items = [...previous.items];
  const roles = { current: null, next: null, prev: null };
  const taken = new Set();

  for (const role of ROLES) {
    const item = wanted[role];
    if (!item) continue;
    const index = items.findIndex(
      (slot, slotIndex) => !taken.has(slotIndex) && slot?.key === item.key,
    );
    if (index === -1) continue;
    roles[role] = index;
    taken.add(index);
    items[index] = placeItem(items[index], item);
  }

  for (const role of ROLES) {
    const item = wanted[role];
    if (!item || roles[role] !== null) continue;
    const free = items
      .map((_, slotIndex) => slotIndex)
      .filter((slotIndex) => !taken.has(slotIndex));
    const sameRole = previous.roles[role];
    const index = free.includes(sameRole) ? sameRole : free[0];
    roles[role] = index;
    taken.add(index);
    items[index] = placeItem(items[index], item);
  }

  // 每次渲染传进来的都是新对象；内容没变就沿用上次的结果，卡片不重渲染
  const unchanged =
    ROLES.every((role) => roles[role] === previous.roles[role]) &&
    items.every((item, index) => sameItem(item, previous.items[index]));
  return unchanged ? previous : { items, roles };
}

export function roleOfSlot(roles, index) {
  return ROLES.find((role) => roles[role] === index) ?? null;
}

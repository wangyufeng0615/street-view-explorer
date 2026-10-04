import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import StreetView from "../StreetView";
import useStore from "../../store/useStore";
import useFeedSwipe from "../../hooks/useFeedSwipe";
import { locationFromStop } from "../../hooks/useHomeJourney";
import { formatAddress } from "../../utils/addressUtils";
import {
  readLocalStorage,
  writeLocalStorage,
} from "../../utils/safeStorage";
import {
  assignFeedSlots,
  EMPTY_FEED,
  PENDING_KEY,
  roleOfSlot,
} from "./feedSlots";
import { CompassGlyph } from "./HomeGlyphs";

// 松手时滑过屏幕高度的这个比例，或者快速甩动，就切到下一张
const COMMIT_RATIO = 0.18;
const FLING_VELOCITY = 0.45; // px/ms
const MIN_COMMIT_PX = 24;
const SNAP_MIN_MS = 200;
const SNAP_MAX_MS = 380;
const SNAP_EASE = "cubic-bezier(0.22, 0.8, 0.24, 1)";
// 没有上一张/下一张（第一站往下拉、正在出发）时只给一点阻尼，不翻页
const RUBBER_RATIO = 0.25;
const RUBBER_MAX_PX = 72;

const REST_Z = { current: 3, next: 2, prev: 1 };
const SWIPE_IGNORE = "a, input, textarea, select, [data-feed-noswipe]";
const HINT_STORAGE_KEY = "homeFeedSwipeLearned";
const HINT_DELAY_MS = 1200;
const HINT_VISIBLE_MS = 7000;

// 旅程里的站点对象在列表里是稳定的，换成位置对象时缓存起来，卡片不会因为新对象重渲染
const stopLocations = new WeakMap();
function stopLocation(stop) {
  let location = stopLocations.get(stop);
  if (!location) {
    location = locationFromStop(stop);
    stopLocations.set(stop, location);
  }
  return location;
}

// 卡片底部放来信开头几行（CSS 截到四行）；整行的旁注（[场景白描]）不放进摘要
function letterExcerpt(text) {
  if (!text) return "";
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^[[【［].+[\]】］]$/.test(line))
    .join(" ")
    .slice(0, 320);
}

const FeedPanorama = memo(function FeedPanorama({
  location,
  active,
  paused,
  onPovChanged,
  onViewChanged,
  onLoadError,
}) {
  // 只有当前卡片跟随外部朝向（语音"看向某处"）；备用卡片固定从正北开始
  const heading = useStore((state) => (active ? state.heading : 0));
  return (
    <div className="street-view-container">
      <StreetView
        panoId={location?.pano_id}
        latitude={location?.latitude}
        longitude={location?.longitude}
        heading={heading}
        paused={paused}
        interactionTip={false}
        compactControls
        onPovChanged={active ? onPovChanged : undefined}
        onViewChanged={active ? onViewChanged : undefined}
        onLoadError={active ? onLoadError : undefined}
      />
    </div>
  );
});

const FeedCaption = memo(function FeedCaption({
  label,
  excerpt,
  active,
  onOpen,
}) {
  const { t } = useTranslation();
  if (!label) return null;
  const open = (event) => {
    if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    onOpen?.();
  };
  return (
    <div
      className="home-feed__caption home-bare"
      role={active ? "button" : undefined}
      tabIndex={active ? 0 : undefined}
      aria-label={active ? `${label}: ${t("home.feed.openLetter")}` : undefined}
      onClick={active ? open : undefined}
      onKeyDown={active ? open : undefined}
    >
      <span className="home-feed__place">{label}</span>
      {active && excerpt && (
        <span className="home-feed__excerpt">{excerpt}</span>
      )}
      {active && (
        <span className="home-feed__more">{t("home.feed.openLetter")}</span>
      )}
    </div>
  );
});

function useSwipeHint({ enabled, ready }) {
  const [state, setState] = useState(() =>
    readLocalStorage(HINT_STORAGE_KEY) === "1" ? "learned" : "waiting",
  );

  useEffect(() => {
    if (!enabled || !ready || state !== "waiting") return undefined;
    const timerId = window.setTimeout(() => setState("shown"), HINT_DELAY_MS);
    return () => window.clearTimeout(timerId);
  }, [enabled, ready, state]);

  // 这次没滑就先收起，下次打开网页再提示，直到真正滑过一次
  useEffect(() => {
    if (state !== "shown") return undefined;
    const timerId = window.setTimeout(() => setState("dismissed"), HINT_VISIBLE_MS);
    return () => window.clearTimeout(timerId);
  }, [state]);

  const learn = useCallback(() => {
    writeLocalStorage(HINT_STORAGE_KEY, "1");
    setState("learned");
  }, []);

  return { visible: enabled && state === "shown", learn };
}

/**
 * 手机首页：全屏街景卡片上下滑动换站，像短视频一样。上滑去下一站（旅程里往后的一站，
 * 或者后台预取好的新地点），下拉回到上一站。下一站在后台提前装进一张看不见的卡片，
 * 滑上来时画面已经就绪。左右拖动仍然是转动街景。
 */
export default function HomeFeed({
  location,
  journeyStops,
  isBusy,
  paused,
  hasLanded,
  swipeEnabled,
  description,
  isLoadingDesc,
  descError,
  onNext,
  onPrev,
  onOpenLetter,
  onPovChanged,
  onViewChanged,
  onLoadError,
  children,
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language || "en";
  const prefetchedLocation = useStore((state) => state.prefetchedLocation);

  const index = location
    ? journeyStops.findIndex((stop) => stop.panoId === location.pano_id)
    : -1;
  // 当前站还没记进旅程（刚到达的那一次渲染）时，旅程最后一站就是上一站
  const prevStop =
    index > 0 ? journeyStops[index - 1] : index === -1 ? journeyStops.at(-1) : null;
  const nextStop =
    index !== -1 && index < journeyStops.length - 1
      ? journeyStops[index + 1]
      : null;

  const stopItem = (stop) =>
    stop && {
      key: stop.panoId,
      location: stopLocation(stop),
      label: stop.address ? formatAddress(stop.address, language) : stop.label,
    };
  const locationItem = (place) =>
    place && {
      key: place.pano_id,
      location: place,
      label: formatAddress(place, language),
    };

  const [feed, setFeed] = useState(EMPTY_FEED);
  // 上一站多数时候就是刚滑走的那张卡片，画面还在；刷新页面或从旅程跳过来时它还没加载，
  // 等用户第一次往下拉才建街景，不看回头路的人不多一次地图加载
  const [prevArmed, setPrevArmed] = useState(false);
  const prevLoaded =
    prevStop && feed.items.some((item) => item?.key === prevStop.panoId);

  const wanted = {
    current: location ? locationItem(location) : { key: PENDING_KEY },
    // 回到旧站之后先沿着旅程往后走；走到头再用预取的新地点，还没取到就先放一张空卡片
    next: nextStop
      ? stopItem(nextStop)
      : prefetchedLocation
        ? locationItem(prefetchedLocation)
        : location
          ? { key: PENDING_KEY }
          : null,
    prev:
      prevStop &&
      prevStop.panoId !== location?.pano_id &&
      (prevArmed || prevLoaded)
        ? stopItem(prevStop)
        : null,
  };

  const nextFeed = assignFeedSlots(feed, wanted);
  if (nextFeed !== feed) setFeed(nextFeed);
  const { items, roles } = nextFeed;

  // —— 拖动和吸附动画直接写 DOM 样式，不经过 React 渲染 ——
  const areaRef = useRef(null);
  const slotRefs = useRef([]);
  const rolesRef = useRef(roles);
  const motionRef = useRef({
    dragging: false,
    animating: false,
    dy: 0,
    timerId: null,
    finish: null,
  });
  const isBusyRef = useRef(isBusy);
  isBusyRef.current = isBusy;
  // 松手时按这一刻的上一站/下一站换站：旅程里的站点直接回去，没有下一站就出发去新地点
  const navigateRef = useRef(null);
  navigateRef.current = (direction) =>
    direction === "next" ? onNext(nextStop) : onPrev(prevStop);

  const slotFor = (role) => {
    const slotIndex = rolesRef.current[role];
    return slotIndex == null ? null : slotRefs.current[slotIndex];
  };
  const canGo = (direction) =>
    !isBusyRef.current && rolesRef.current[direction] != null;

  const applyRest = useCallback(() => {
    slotRefs.current.forEach((element, slotIndex) => {
      if (!element) return;
      const role = roleOfSlot(rolesRef.current, slotIndex);
      element.style.transition = "none";
      element.style.transform = "";
      element.style.zIndex = String(REST_Z[role] ?? 0);
      element.style.visibility = role ? "" : "hidden";
    });
  }, []);

  // 当前卡片跟手；要进来的那张贴在它上方或下方一起移动，其余卡片藏起来，空出来的地方露出底色
  const placeSlots = (offset, transition) => {
    const height = areaRef.current?.clientHeight || window.innerHeight;
    const direction = offset < 0 ? "next" : offset > 0 ? "prev" : null;
    const current = slotFor("current");
    const incoming = direction && canGo(direction) ? slotFor(direction) : null;
    slotRefs.current.forEach((element) => {
      if (!element) return;
      element.style.transition = transition;
      if (element === current) {
        element.style.transform = `translate3d(0, ${offset}px, 0)`;
        element.style.zIndex = "3";
        element.style.visibility = "";
      } else if (element === incoming) {
        const base = direction === "next" ? height : -height;
        element.style.transform = `translate3d(0, ${base + offset}px, 0)`;
        element.style.zIndex = "4";
        element.style.visibility = "";
      } else {
        element.style.visibility = "hidden";
      }
    });
  };

  const dragOffset = (dy) => {
    const direction = dy < 0 ? "next" : "prev";
    if (dy === 0 || canGo(direction)) return dy;
    return Math.sign(dy) * Math.min(RUBBER_MAX_PX, Math.abs(dy) * RUBBER_RATIO);
  };

  const animate = (offset, durationMs, done) => {
    const motion = motionRef.current;
    motion.animating = true;
    placeSlots(offset, `transform ${Math.round(durationMs)}ms ${SNAP_EASE}`);
    window.clearTimeout(motion.timerId);
    const finish = () => {
      window.clearTimeout(motion.timerId);
      motion.animating = false;
      motion.finish = null;
      done();
    };
    motion.finish = finish;
    motion.timerId = window.setTimeout(finish, durationMs + 20);
  };

  const hint = useSwipeHint({
    enabled: swipeEnabled,
    ready: hasLanded && roles.next != null,
  });
  const learnHintRef = useRef(hint.learn);
  learnHintRef.current = hint.learn;

  const commit = (direction) => {
    const before = rolesRef.current.current;
    learnHintRef.current();
    navigateRef.current(direction);
    // store 会同步换到新地点，下一帧前角色就已经轮换；没换成（比如正好被别的导航抢先）就放回原位
    window.requestAnimationFrame(() => {
      if (rolesRef.current.current === before && !motionRef.current.dragging) {
        applyRest();
      }
    });
  };

  useFeedSwipe(areaRef, {
    enabled: swipeEnabled,
    ignoreSelector: SWIPE_IGNORE,
    onStart: () => {
      const motion = motionRef.current;
      // 上一张还在吸附时又滑了一下：立刻完成上一次切换，接着从新的当前卡片开始拖。
      // store 同步换站，React 在下一个触摸事件之前就把角色换好
      motion.finish?.();
      motion.dragging = true;
      motion.dy = 0;
    },
    onMove: (dy) => {
      const motion = motionRef.current;
      if (dy > 0 && !prevArmed && prevStop) setPrevArmed(true);
      motion.dy = dy;
      placeSlots(dragOffset(dy), "none");
    },
    onEnd: (dy, velocity) => {
      const motion = motionRef.current;
      motion.dragging = false;
      const height = areaRef.current?.clientHeight || window.innerHeight;
      const direction = dy < 0 ? "next" : "prev";
      const flung =
        Math.abs(velocity) > FLING_VELOCITY &&
        Math.sign(velocity) === Math.sign(dy);
      const shouldCommit =
        canGo(direction) &&
        Math.abs(dy) > MIN_COMMIT_PX &&
        (Math.abs(dy) > height * COMMIT_RATIO || flung);

      if (shouldCommit) {
        const target = direction === "next" ? -height : height;
        const speed = Math.max(Math.abs(velocity), 1.6);
        const duration = Math.min(
          SNAP_MAX_MS,
          Math.max(SNAP_MIN_MS, Math.abs(target - dy) / speed),
        );
        animate(target, duration, () => commit(direction));
        return;
      }
      const offset = dragOffset(dy);
      animate(0, Math.min(SNAP_MAX_MS, 160 + Math.abs(offset) * 0.4), applyRest);
    },
    onCancel: () => {
      const motion = motionRef.current;
      motion.dragging = false;
      animate(0, SNAP_MIN_MS, applyRest);
    },
  });

  // 角色变了（滑动换站、地图选点、语音导航、预取到了下一站）：卡片回到静止位置。
  // 拖动中途有变化就按新角色接着拖；吸附动画进行中不打断，动画结束时会按最新角色摆放
  const rolesKey = `${roles.current}:${roles.next}:${roles.prev}`;
  useLayoutEffect(() => {
    rolesRef.current = roles;
    const motion = motionRef.current;
    if (motion.dragging) {
      placeSlots(dragOffset(motion.dy), "none");
    } else if (!motion.animating) {
      applyRest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在角色对应的卡片变化时重新摆放；摆放函数只读 ref
  }, [rolesKey, applyRest]);

  useEffect(
    () => () => window.clearTimeout(motionRef.current.timerId),
    [],
  );

  const excerpt = descError
    ? ""
    : letterExcerpt(description) ||
      (isLoadingDesc ? t("home.feed.writing") : "");

  return (
    <div className="home-feed" ref={areaRef}>
      {items.map((item, slotIndex) => {
        const role = roleOfSlot(roles, slotIndex);
        const active = role === "current";
        return (
          <div
            // 卡片按位置固定，里面的街景实例跟着卡片走，换角色不重建
            key={slotIndex}
            className="home-feed__slot"
            ref={(element) => {
              slotRefs.current[slotIndex] = element;
            }}
            data-role={role || "idle"}
            aria-hidden={active ? undefined : true}
            inert={active ? undefined : ""}
          >
            {item?.location && (
              <FeedPanorama
                location={item.location}
                active={active}
                paused={!active || paused}
                onPovChanged={onPovChanged}
                onViewChanged={onViewChanged}
                onLoadError={onLoadError}
              />
            )}
            <div className="home-feed__shade" aria-hidden="true" />
            {item?.pending ? (
              <div className="home-feed__pending" aria-hidden="true">
                <CompassGlyph size={24} strokeWidth={1.6} />
              </div>
            ) : (
              <FeedCaption
                label={item?.label}
                excerpt={active ? excerpt : ""}
                active={active}
                onOpen={onOpenLetter}
              />
            )}
          </div>
        );
      })}

      {children}

      <div
        className={`home-feed__hint${hint.visible ? " is-visible" : ""}`}
        aria-hidden="true"
      >
        <svg
          className="home-feed__hint-arrow"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 14l6-6 6 6" />
        </svg>
        <span className="home-feed__hint-title">{t("home.feed.hint")}</span>
        <span className="home-feed__hint-sub">{t("home.feed.hintRotate")}</span>
      </div>
    </div>
  );
}

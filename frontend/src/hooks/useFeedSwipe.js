import { useEffect, useRef } from "react";

// 手指先移动这么远才判断方向；判断之前的移动照常交给街景，左右转动不会有延迟
const AXIS_LOCK_PX = 10;
// 上下滑结束后，浏览器可能还会补发一次 click，街景会把它当成"点地面前进"
const CLICK_SUPPRESS_MS = 400;
const VELOCITY_WINDOW_MS = 100;

// 自己补发给街景的取消事件带着这个标记，捕获阶段遇到时直接放行
const SYNTHETIC = Symbol("feedSwipeSynthetic");

function isTouchLike(event) {
  return event.pointerType === "touch" || event.pointerType === "pen";
}

// 让街景干净地结束它已经开始的拖动：Google 同时监听指针和触摸事件，两种都补一个取消
function cancelForStreetView(gesture) {
  const { target, pointerId, pointerType, touch } = gesture;
  if (!target?.isConnected) return;
  try {
    const pointerCancel = new PointerEvent("pointercancel", {
      bubbles: true,
      pointerId,
      pointerType,
      isPrimary: true,
    });
    pointerCancel[SYNTHETIC] = true;
    target.dispatchEvent(pointerCancel);
  } catch {
    // 老浏览器没有 PointerEvent 构造函数
  }
  if (!touch || typeof TouchEvent !== "function") return;
  try {
    const touchCancel = new TouchEvent("touchcancel", {
      bubbles: true,
      touches: [],
      targetTouches: [],
      changedTouches: [touch],
    });
    touchCancel[SYNTHETIC] = true;
    target.dispatchEvent(touchCancel);
  } catch {
    // 有些浏览器不允许脚本构造 TouchEvent，指针取消已经足够
  }
}

function velocityOf(samples) {
  const last = samples[samples.length - 1];
  const first =
    samples.find((sample) => last.t - sample.t <= VELOCITY_WINDOW_MS) || last;
  const elapsed = last.t - first.t;
  return elapsed > 0 ? (last.y - first.y) / elapsed : 0;
}

/**
 * 手机首页的上下滑动：在 window 捕获阶段先于街景拿到触摸事件。手指上下滑时，
 * 后续移动和抬起都不再交给街景，并补发取消让它结束拖动；左右滑和双指缩放完全交给街景。
 * 鼠标拖动不处理：Google 在 window 上监听鼠标，拦不干净，电脑上用按钮和空格切换。
 *
 * handlers: { onStart(), onMove(dy), onEnd(dy, velocity), onCancel() }
 * ignoreSelector：从这些元素上开始的触摸不算滑动（比如链接、输入框）
 */
export default function useFeedSwipe(
  areaRef,
  { enabled, ignoreSelector, ...handlers },
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return undefined;
    let gesture = null;
    let swallowTouchEnd = false;
    let suppressClickUntil = 0;
    // 不同浏览器里指针事件和触摸事件谁先到不一定，两边都记下按下时的触点
    let lastTouchStart = null;

    const isOurs = (event) => gesture && event.pointerId === gesture.pointerId;

    const stop = (event) => {
      event.stopPropagation();
      if (event.cancelable) event.preventDefault();
    };

    const onPointerDown = (event) => {
      if (!isTouchLike(event)) return;
      if (!event.isPrimary) {
        // 第二根手指：还没判断方向就交给街景缩放；已经在上下滑就忽略它
        if (gesture && !gesture.axis) gesture = null;
        return;
      }
      const area = areaRef.current;
      if (!area || !area.contains(event.target)) return;
      if (ignoreSelector && event.target.closest?.(ignoreSelector)) return;
      gesture = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        target: event.target,
        touch:
          lastTouchStart && event.timeStamp - lastTouchStart.t < 50
            ? lastTouchStart.touch
            : null,
        startX: event.clientX,
        startY: event.clientY,
        axis: null,
        samples: [{ y: 0, t: event.timeStamp }],
      };
    };

    const onPointerMove = (event) => {
      if (!isOurs(event)) return;
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (!gesture.axis) {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
        if (Math.abs(dx) >= Math.abs(dy)) {
          gesture = null;
          return;
        }
        gesture.axis = "y";
        cancelForStreetView(gesture);
        handlersRef.current.onStart?.();
      }
      stop(event);
      gesture.samples.push({ y: dy, t: event.timeStamp });
      if (gesture.samples.length > 12) gesture.samples.shift();
      handlersRef.current.onMove?.(dy);
    };

    const onPointerUp = (event) => {
      if (!isOurs(event)) return;
      const finished = gesture;
      gesture = null;
      if (!finished.axis) return;
      stop(event);
      swallowTouchEnd = true;
      suppressClickUntil = event.timeStamp + CLICK_SUPPRESS_MS;
      const dy = event.clientY - finished.startY;
      finished.samples.push({ y: dy, t: event.timeStamp });
      handlersRef.current.onEnd?.(dy, velocityOf(finished.samples));
    };

    const onPointerCancel = (event) => {
      if (event[SYNTHETIC] || !isOurs(event)) return;
      const cancelled = gesture;
      gesture = null;
      if (cancelled.axis) handlersRef.current.onCancel?.();
    };

    // 指针事件先于对应的触摸事件派发，这里只负责把已经接管的触摸挡在街景外面
    const onTouchStart = (event) => {
      const touch = event.changedTouches?.[0] || null;
      lastTouchStart = { touch, t: event.timeStamp };
      if (gesture && !gesture.axis && !gesture.touch) gesture.touch = touch;
    };

    const onTouchMove = (event) => {
      if (gesture?.axis) stop(event);
    };

    const onTouchEnd = (event) => {
      if (event[SYNTHETIC]) return;
      if (gesture?.axis || swallowTouchEnd) {
        swallowTouchEnd = false;
        stop(event);
      }
    };

    const onClick = (event) => {
      if (event.timeStamp < suppressClickUntil) {
        suppressClickUntil = 0;
        stop(event);
      }
    };

    const capture = { capture: true };
    const activeCapture = { capture: true, passive: false };
    window.addEventListener("pointerdown", onPointerDown, capture);
    window.addEventListener("pointermove", onPointerMove, activeCapture);
    window.addEventListener("pointerup", onPointerUp, capture);
    window.addEventListener("pointercancel", onPointerCancel, capture);
    window.addEventListener("touchstart", onTouchStart, capture);
    window.addEventListener("touchmove", onTouchMove, activeCapture);
    window.addEventListener("touchend", onTouchEnd, activeCapture);
    window.addEventListener("touchcancel", onTouchEnd, capture);
    window.addEventListener("click", onClick, capture);
    return () => {
      // 正在滑动时被关掉（比如屏幕变宽），让外层把卡片放回原位
      if (gesture?.axis) handlersRef.current.onCancel?.();
      window.removeEventListener("pointerdown", onPointerDown, capture);
      window.removeEventListener("pointermove", onPointerMove, activeCapture);
      window.removeEventListener("pointerup", onPointerUp, capture);
      window.removeEventListener("pointercancel", onPointerCancel, capture);
      window.removeEventListener("touchstart", onTouchStart, capture);
      window.removeEventListener("touchmove", onTouchMove, activeCapture);
      window.removeEventListener("touchend", onTouchEnd, activeCapture);
      window.removeEventListener("touchcancel", onTouchEnd, capture);
      window.removeEventListener("click", onClick, capture);
    };
  }, [areaRef, enabled, ignoreSelector]);
}

import React, {
  lazy,
  memo,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { MicGlyph } from "../AtlasVoiceGlyphs";
import useDismiss from "../../hooks/useDismiss";
import { EXPLORATION_MODES } from "../../hooks/useExplorationMode";
import { formatAddress } from "../../utils/addressUtils";
import { CheckGlyph, CompassGlyph, RouteGlyph } from "./HomeGlyphs";
// 语音面板单独的样式先跟首页一起加载，占位按钮和真按钮长得一样
import "../../styles/AtlasVoicePanel.css";

// 语音模块（实时连接、音频、工具）不在首屏需要，等街景加载完再取
const loadVoicePanel = () => import("../AtlasVoicePanel");
const AtlasVoicePanel = lazy(loadVoicePanel);
const VOICE_LOAD_TIMEOUT_MS = 2500;

function VoicePlaceholder() {
  const { t } = useTranslation();
  return (
    <div className="atlas-voice-panel atlas-voice-panel--idle">
      <button
        type="button"
        className="atlas-voice-button"
        disabled
        aria-label={t("home.voice.start")}
      >
        <span className="atlas-voice-glyph" aria-hidden="true">
          <MicGlyph />
        </span>
        <span className="atlas-voice-label">{t("home.voice.title")}</span>
      </button>
    </div>
  );
}

// 语音面板出任何错（包括分包没加载到）都只退回占位按钮，不能连累整个首页
class VoiceBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.warn("Atlas Voice failed to load:", error);
  }

  render() {
    return this.state.failed ? <VoicePlaceholder /> : this.props.children;
  }
}

function useIdleVoiceLoad() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready) return undefined;
    // 分包没取到（断网、发版后旧分包已删）就一直显示占位按钮，不去渲染必然失败的懒加载组件
    const start = () => {
      loadVoicePanel().then(
        () => setReady(true),
        (error) => console.warn("Atlas Voice chunk failed to load:", error),
      );
    };
    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(start, {
        timeout: VOICE_LOAD_TIMEOUT_MS,
      });
      return () => window.cancelIdleCallback?.(idleId);
    }
    const timerId = window.setTimeout(start, 600);
    return () => window.clearTimeout(timerId);
  }, [ready]);
  return ready;
}

// 只在有鼠标键盘的设备上自动聚焦输入框；手机上一聚焦就弹出键盘，挡住大半个屏幕
function canAutoFocusInput() {
  return (
    window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? true
  );
}

/**
 * Two options of the same shape: anywhere, or a place/theme typed in place.
 * The current choice carries the check mark, so the panel always shows what
 * "next stop" will do.
 */
function WherePanel({
  explorationMode,
  explorationInterest,
  isSavingPreference,
  preferenceError,
  onPickRandom,
  onPickInterest,
}) {
  const { t } = useTranslation();
  const [interest, setInterest] = useState(explorationInterest || "");
  const [autoFocus] = useState(canAutoFocusInput);
  const trimmed = interest.trim();
  const isRandom = explorationMode === EXPLORATION_MODES.RANDOM;

  const submit = (event) => {
    event.preventDefault();
    if (trimmed && !isSavingPreference) onPickInterest(trimmed);
  };

  return (
    <div
      className="home-popover home-dock__popover home-where"
      role="dialog"
      aria-label={t("home.where.title")}
    >
      <div className="home-popover__title">{t("home.where.title")}</div>
      <button
        type="button"
        className="home-where__option"
        aria-pressed={isRandom}
        disabled={isSavingPreference}
        onClick={onPickRandom}
      >
        <span className="home-where__head">
          <span className="home-where__name">{t("home.where.random")}</span>
          {isRandom && <CheckGlyph size={16} />}
        </span>
        <span className="home-where__desc">{t("home.where.randomDesc")}</span>
      </button>
      <form
        className={`home-where__option home-where__custom${
          isRandom ? "" : " is-selected"
        }`}
        onSubmit={submit}
      >
        <label className="home-where__head" htmlFor="home-where-interest">
          <span className="home-where__name">{t("home.where.interest")}</span>
          {!isRandom && <CheckGlyph size={16} />}
        </label>
        <div className="home-where__row">
          <input
            id="home-where-interest"
            className="home-input"
            value={interest}
            onChange={(event) => setInterest(event.target.value)}
            placeholder={t("home.where.placeholder")}
            disabled={isSavingPreference}
            // 与后端上限一致（按字符计）
            maxLength={50}
            autoFocus={autoFocus}
            autoComplete="off"
            enterKeyHint="go"
          />
          <button
            type="submit"
            className={`home-button-primary home-where__go${
              isSavingPreference ? " is-busy" : ""
            }`}
            disabled={!trimmed || isSavingPreference}
          >
            {isSavingPreference ? t("home.where.saving") : t("home.where.go")}
          </button>
        </div>
        {preferenceError && (
          <p className="home-where__error" role="alert">
            {preferenceError}
          </p>
        )}
      </form>
    </div>
  );
}

function JourneyPanel({ stops, currentPanoId, isBusy, onRevisit }) {
  const { t, i18n } = useTranslation();
  const language = i18n?.resolvedLanguage || i18n?.language || "en";
  const newestFirst = [...stops].reverse();
  const panelRef = useRef(null);

  // 浮层在 DOM 里排在按钮前面，打开后把焦点移进来，键盘用户才能用 Tab 选站
  useEffect(() => {
    const panel = panelRef.current;
    const target = panel?.querySelector("button:not(:disabled)") || panel;
    target?.focus();
  }, []);

  return (
    <div
      className="home-popover home-dock__popover"
      role="dialog"
      aria-label={t("home.journey.title")}
      ref={panelRef}
      tabIndex={-1}
    >
      <div className="home-popover__title">
        {t("home.journey.title")}
        <span className="home-popover__count">
          {t("home.journey.count", { count: stops.length })}
        </span>
      </div>
      {newestFirst.length === 0 ? (
        <p className="home-journey__empty">{t("home.journey.empty")}</p>
      ) : (
        <ol className="home-journey">
          {newestFirst.map((stop, index) => {
            const isCurrent = stop.panoId === currentPanoId;
            return (
              <li key={stop.panoId}>
                <button
                  type="button"
                  className="home-menu-item home-journey__stop"
                  // 正在出发时不能改道，否则新旧两个地点会互相覆盖
                  disabled={isCurrent || isBusy}
                  onClick={() => onRevisit(stop)}
                >
                  <span className="home-journey__index">
                    {stops.length - index}
                  </span>
                  <span className="home-journey__label">
                    {stop.address
                      ? formatAddress(stop.address, language)
                      : stop.label}
                  </span>
                  {isCurrent && (
                    <span className="home-journey__current">
                      {t("home.journey.current")}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// layout："bar" 是街景底部一排按钮；"rail" 是手机上滑模式右侧竖排的按钮，
// 那里换站靠上滑，"下一站"只在有鼠标的窄窗口里显示（读屏软件始终能找到）
const HomeDock = memo(function HomeDock({
  layout = "bar",
  isBusy,
  onNext,
  explorationMode,
  explorationInterest,
  isSavingPreference,
  preferenceError,
  onPickRandom,
  onPickInterest,
  stops,
  currentPanoId,
  onRevisit,
}) {
  const { t } = useTranslation();
  const [openPanel, setOpenPanel] = useState(null);
  const dockRef = useRef(null);
  const triggerRefs = useRef({});
  const wasSavingRef = useRef(false);
  const voiceReady = useIdleVoiceLoad();

  useDismiss(Boolean(openPanel), dockRef, (reason) => {
    if (reason === "escape") triggerRefs.current[openPanel]?.focus();
    setOpenPanel(null);
  });

  // Close "where to" once a saved interest has started loading without error.
  useEffect(() => {
    if (wasSavingRef.current && !isSavingPreference && !preferenceError) {
      setOpenPanel(null);
    }
    wasSavingRef.current = isSavingPreference;
  }, [isSavingPreference, preferenceError]);

  const togglePanel = (panel) =>
    setOpenPanel((current) => (current === panel ? null : panel));

  const whereLabel =
    explorationMode === EXPLORATION_MODES.CUSTOM && explorationInterest
      ? explorationInterest
      : t("home.where.randomLabel");
  const stopCount = t("home.journey.count", { count: stops.length });

  return (
    <div
      className={`home-dock${layout === "rail" ? " home-dock--rail" : ""}`}
      ref={dockRef}
    >
      {openPanel === "where" && (
        <WherePanel
          explorationMode={explorationMode}
          explorationInterest={explorationInterest}
          isSavingPreference={isSavingPreference}
          preferenceError={preferenceError}
          onPickRandom={() => {
            setOpenPanel(null);
            onPickRandom();
          }}
          onPickInterest={onPickInterest}
        />
      )}
      {openPanel === "journey" && (
        <JourneyPanel
          stops={stops}
          currentPanoId={currentPanoId}
          isBusy={isBusy}
          onRevisit={(stop) => {
            setOpenPanel(null);
            onRevisit(stop);
          }}
        />
      )}

      <button
        type="button"
        className="home-dock__button home-bare"
        ref={(node) => {
          triggerRefs.current.journey = node;
        }}
        aria-label={`${t("home.journey.title")}: ${stopCount}`}
        aria-expanded={openPanel === "journey"}
        aria-haspopup="dialog"
        onClick={() => togglePanel("journey")}
      >
        <RouteGlyph />
        <span>{t("home.journey.short")}</span>
        <span className="home-dock__count">{stopCount}</span>
      </button>

      <button
        type="button"
        className="home-dock__button home-dock__where home-bare"
        ref={(node) => {
          triggerRefs.current.where = node;
        }}
        aria-label={`${t("home.where.title")}: ${whereLabel}`}
        aria-expanded={openPanel === "where"}
        aria-haspopup="dialog"
        onClick={() => togglePanel("where")}
      >
        <CompassGlyph size={17} />
        <span className="home-dock__where-label">{whereLabel}</span>
      </button>

      <button
        type="button"
        className="home-dock__next home-button-primary"
        onClick={onNext}
        disabled={isBusy}
        aria-keyshortcuts="Space"
      >
        {isBusy ? (
          <>
            <span className="home-spinner" aria-hidden="true" />
            <span>{t("home.departing")}</span>
          </>
        ) : (
          <>
            <span>{t("home.next")}</span>
            {/* 快捷键提示：键盘用户一看就懂，读屏软件通过 aria-keyshortcuts 获知 */}
            <kbd className="home-dock__kbd" aria-hidden="true">
              {t("home.spaceKey")}
            </kbd>
          </>
        )}
      </button>

      {voiceReady ? (
        <VoiceBoundary>
          <Suspense fallback={<VoicePlaceholder />}>
            <AtlasVoicePanel />
          </Suspense>
        </VoiceBoundary>
      ) : (
        <VoicePlaceholder />
      )}
    </div>
  );
});

export default HomeDock;

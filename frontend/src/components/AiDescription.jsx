import React, {
  memo,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";
import { streamLocationDetailedDescription } from "../services/api";
import "../styles/AiDescription.css";

function detectLanguage(text) {
  if (!text) return "en";
  const chineseChars = text.match(/[一-鿿]/g) || [];
  const totalChars = text.replace(/\s/g, "").length;
  return totalChars > 0 && chineseChars.length / totalChars > 0.3 ? "zh" : "en";
}

// 整行的 [场景白描/心理活动] / 【…】 单独排版成旁注，可出现在文中任意位置
function splitNarration(text) {
  const paragraphs = (text || "")
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean);

  const items = paragraphs.map((paragraph) => {
    const match = paragraph.match(/^[[【](.+)[\]】]$/);
    return match
      ? { type: "scene", text: match[1].trim() }
      : { type: "paragraph", text: paragraph };
  });

  // 全文只有旁注没有正文时，按普通段落显示，避免整段斜体
  if (items.length > 0 && items.every((item) => item.type === "scene")) {
    return paragraphs.map((paragraph) => ({
      type: "paragraph",
      text: paragraph,
    }));
  }

  return items;
}

const CompassGlyph = ({ className, needleClassName }) => (
  <svg
    className={className}
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path
      className={needleClassName}
      d="M15.8 8.2l-2.4 5.2-5.2 2.4 2.4-5.2z"
      fill="currentColor"
      stroke="none"
    />
  </svg>
);

const SearchGlyph = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.3"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="10.5" cy="10.5" r="7" />
    <line x1="20.5" y1="20.5" x2="15.8" y2="15.8" />
  </svg>
);

const ThinkingIndicator = memo(function ThinkingIndicator({
  title,
  variant = "primary",
  elementRef = null,
}) {
  return (
    <div
      ref={elementRef}
      className={`atlas-thinking-indicator atlas-thinking-indicator--${variant}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={title}
    >
      <div className="atlas-thinking-mark" aria-hidden="true">
        <div className="compass-seek-motion">
          <CompassGlyph />
        </div>
      </div>
      <div className="atlas-thinking-title">{title}</div>
    </div>
  );
});

const CitationLinks = memo(function CitationLinks({ citations, label }) {
  if (!citations || citations.length === 0) return null;
  return (
    <div className="citations-container">
      <span className="citations-label">{label}</span>
      <ol className="citations-list">
        {citations.map((cite, i) => (
          <li key={i} className="citation-item">
            <a
              className="citation-link"
              href={cite.url}
              target="_blank"
              rel="noopener noreferrer"
              title={cite.url}
            >
              <span className="citation-index">{i + 1}</span>
              <span className="citation-title">
                {cite.title || new URL(cite.url).hostname}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
});

const NarrationBody = memo(function NarrationBody({
  text,
  citations,
  citationsLabel,
}) {
  const items = useMemo(() => splitNarration(text), [text]);
  return (
    <div className="ai-content" lang={detectLanguage(text)} aria-live="polite">
      {items.map((item, index) =>
        item.type === "scene" ? (
          <div key={index} className="ai-scene-note">
            {item.text}
          </div>
        ) : (
          <p key={index} className="ai-paragraph">
            {item.text}
          </p>
        ),
      )}
      <CitationLinks citations={citations} label={citationsLabel} />
    </div>
  );
});

const AiDescription = memo(
  function AiDescription({
    voiceControl = null,
    isLoading,
    error,
    description,
    citations,
    retries,
    panoId,
    heading = 0,
    view = null,
    onRetry,
  }) {
    const { t, i18n } = useTranslation();

    const [detailedDescription, setDetailedDescription] = useState(null);
    const [detailedCitations, setDetailedCitations] = useState(null);
    const [isLoadingDetailed, setIsLoadingDetailed] = useState(false);
    const [detailedError, setDetailedError] = useState(null);
    const [hasRequestedDetailed, setHasRequestedDetailed] = useState(false);
    const detailedLoadingRef = useRef(null);
    const detailedAbortRef = useRef(null);

    const shouldShowLoading = !description && (isLoading || (panoId && !error));
    const activeLanguage = i18n.resolvedLanguage || i18n.language || "en";
    const isChinese = activeLanguage.startsWith("zh");
    const sectionTitle = isChinese ? "Atlas 说…" : "Atlas says...";
    const citationsLabel = isChinese ? "出处" : "Sources";

    const handleTellMeMore = useCallback(async () => {
      if (!panoId || isLoadingDetailed || hasRequestedDetailed) return;

      if (!description) {
        setDetailedError(t("ai.needBasicDescriptionFirst"));
        return;
      }

      setIsLoadingDetailed(true);
      setDetailedError(null);
      setHasRequestedDetailed(true);
      setDetailedDescription(null);
      setDetailedCitations(null);
      detailedAbortRef.current?.abort();
      const controller = new AbortController();
      detailedAbortRef.current = controller;

      try {
        const result = await streamLocationDetailedDescription(
          panoId,
          activeLanguage,
          controller.signal,
          view || { heading, pitch: 0, fov: 90 },
          (delta) => {
            if (!controller.signal.aborted) {
              setDetailedDescription((current) => `${current || ""}${delta}`);
            }
          },
        );
        if (controller.signal.aborted) return;
        const nextDescription = result.data?.description?.trim();
        if (result.success && nextDescription) {
          setDetailedDescription(nextDescription);
          setDetailedCitations(result.data?.citations || null);
        } else {
          setDetailedError(result.error || t("ai.retryDetailedDescription"));
        }
      } catch (err) {
        setDetailedError(err.message || "获取详细介绍失败");
      } finally {
        if (detailedAbortRef.current === controller) {
          detailedAbortRef.current = null;
          setIsLoadingDetailed(false);
        }
      }
    }, [
      description,
      hasRequestedDetailed,
      heading,
      activeLanguage,
      isLoadingDetailed,
      panoId,
      view,
      t,
    ]);

    const handleRetryDetailed = useCallback(async () => {
      if (!panoId || isLoadingDetailed) return;

      setIsLoadingDetailed(true);
      setDetailedError(null);
      setDetailedDescription(null);
      setDetailedCitations(null);
      detailedAbortRef.current?.abort();
      const controller = new AbortController();
      detailedAbortRef.current = controller;

      try {
        const result = await streamLocationDetailedDescription(
          panoId,
          activeLanguage,
          controller.signal,
          view || { heading, pitch: 0, fov: 90 },
          (delta) => {
            if (!controller.signal.aborted) {
              setDetailedDescription((current) => `${current || ""}${delta}`);
            }
          },
        );
        if (controller.signal.aborted) return;
        const nextDescription = result.data?.description?.trim();
        if (result.success && nextDescription) {
          setDetailedDescription(nextDescription);
          setDetailedCitations(result.data?.citations || null);
          setDetailedError(null);
        } else {
          setDetailedError(result.error || t("ai.retryDetailedDescription"));
        }
      } catch (err) {
        setDetailedError(err.message || "获取详细介绍失败");
      } finally {
        if (detailedAbortRef.current === controller) {
          detailedAbortRef.current = null;
          setIsLoadingDetailed(false);
        }
      }
    }, [activeLanguage, heading, isLoadingDetailed, panoId, t, view]);

    useEffect(() => {
      detailedAbortRef.current?.abort();
      detailedAbortRef.current = null;
      setDetailedDescription(null);
      setDetailedCitations(null);
      setDetailedError(null);
      setHasRequestedDetailed(false);
      setIsLoadingDetailed(false);

      return () => {
        detailedAbortRef.current?.abort();
      };
    }, [activeLanguage, panoId]);

    useEffect(() => {
      if (!isLoadingDetailed || !detailedLoadingRef.current) return undefined;

      const frame = window.requestAnimationFrame(() => {
        const reduceMotion = window.matchMedia?.(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        detailedLoadingRef.current?.scrollIntoView({
          behavior: reduceMotion ? "auto" : "smooth",
          block: "nearest",
        });
      });

      return () => window.cancelAnimationFrame(frame);
    }, [isLoadingDetailed]);

    return (
      <div className="ai-description">
        <div className="ai-description-header">
          <div className="ai-description-title">
            <CompassGlyph className="ai-description-glyph" />
            <span>{sectionTitle}</span>
          </div>
          {voiceControl && (
            <div className="ai-description-voice">{voiceControl}</div>
          )}
        </div>

        <div
          className="ai-description-body"
          aria-busy={shouldShowLoading || isLoadingDetailed}
        >
          {shouldShowLoading ? (
            <ThinkingIndicator
              title={
                retries > 0
                  ? t("ai.retrying", { retries })
                  : t("ai.thinkingTitle")
              }
            />
          ) : error ? (
            <div className="ai-error">
              <div className="ai-error-message">{error}</div>
              <button className="ai-retry-button" onClick={onRetry}>
                {t("ai.retryGetDescription")}
              </button>
            </div>
          ) : description ? (
            <div className="ai-content-container">
              <NarrationBody
                text={description}
                citations={citations}
                citationsLabel={citationsLabel}
              />

              {!isLoading && !hasRequestedDetailed && !detailedDescription && (
                <div className="tell-me-more-container">
                  <button
                    className="tell-me-more-button"
                    onClick={handleTellMeMore}
                    disabled={isLoadingDetailed}
                  >
                    <span className="button-icon">
                      <SearchGlyph />
                    </span>
                    <span className="button-text">
                      {isLoadingDetailed
                        ? t("ai.loadingDetailedDescription")
                        : t("ai.tellMeMore")}
                    </span>
                  </button>
                </div>
              )}

              {isLoadingDetailed && (
                <ThinkingIndicator
                  variant="detailed"
                  elementRef={detailedLoadingRef}
                  title={t("ai.loadingDetailedDescription")}
                />
              )}

              {detailedError && (
                <div className="detailed-error-container">
                  <div className="error-message">{detailedError}</div>
                  <button
                    className="retry-detailed-button"
                    onClick={handleRetryDetailed}
                    disabled={isLoadingDetailed}
                  >
                    {t("ai.retryDetailedDescription")}
                  </button>
                </div>
              )}

              {detailedDescription && (
                <div className="detailed-description">
                  <div className="detailed-title">
                    {t("ai.detailedAnalysisRequested")}
                  </div>
                  <NarrationBody
                    text={detailedDescription}
                    citations={detailedCitations}
                    citationsLabel={citationsLabel}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="ai-no-data">{t("ai.cannotGetStreetView")}</div>
          )}
        </div>
      </div>
    );
  },
  (prevProps, nextProps) =>
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.error === nextProps.error &&
    prevProps.description === nextProps.description &&
    prevProps.citations === nextProps.citations &&
    prevProps.retries === nextProps.retries &&
    prevProps.panoId === nextProps.panoId &&
    prevProps.heading === nextProps.heading &&
    prevProps.view?.panoId === nextProps.view?.panoId &&
    prevProps.view?.heading === nextProps.view?.heading &&
    prevProps.view?.pitch === nextProps.view?.pitch &&
    prevProps.view?.fov === nextProps.view?.fov,
);

export default AiDescription;

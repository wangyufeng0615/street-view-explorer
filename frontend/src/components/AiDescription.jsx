import React, { memo, useState, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getLocationDetailedDescription } from "../services/api";
import "../styles/AiDescription.css";

const LOADING_HINTS = {
  zh: [
    "Atlas 正在看路牌…",
    "Atlas 正在辨认地形…",
    "Atlas 正在打量街角…",
    "Atlas 正在理清来路…",
    "Atlas 正在找这地方的脉络…",
    "Atlas 正在把周围串起来…",
  ],
  en: [
    "Atlas is reading the street...",
    "Atlas is sizing up the block...",
    "Atlas is tracing the route...",
    "Atlas is getting the lay of the land...",
    "Atlas is piecing the place together...",
    "Atlas is checking the local clues...",
  ],
};

function pickLoadingHint(language, panoId) {
  const hints = language === "zh" ? LOADING_HINTS.zh : LOADING_HINTS.en;
  if (!panoId || hints.length === 0) {
    return null;
  }

  let hash = 0;
  for (let i = 0; i < panoId.length; i += 1) {
    hash = (hash * 33 + panoId.charCodeAt(i)) >>> 0;
  }

  return hints[hash % hints.length];
}

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
    return paragraphs.map((paragraph) => ({ type: "paragraph", text: paragraph }));
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

const ThinkingIcon = () => (
  <div className="thinking-icon">
    <CompassGlyph needleClassName="compass-needle" />
  </div>
);

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
    <div className="ai-content" lang={detectLanguage(text)}>
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
    onRetry,
  }) {
    const { t, i18n } = useTranslation();

    const [detailedDescription, setDetailedDescription] = useState(null);
    const [detailedCitations, setDetailedCitations] = useState(null);
    const [isLoadingDetailed, setIsLoadingDetailed] = useState(false);
    const [detailedError, setDetailedError] = useState(null);
    const [hasRequestedDetailed, setHasRequestedDetailed] = useState(false);

    const shouldShowLoading = isLoading || (panoId && !description && !error);
    const loadingHint = useMemo(
      () => pickLoadingHint(i18n.language, panoId),
      [i18n.language, panoId],
    );
    const isChinese = (i18n.resolvedLanguage || i18n.language || "").startsWith("zh");
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

      try {
        const result = await getLocationDetailedDescription(panoId, i18n.language);
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
        setIsLoadingDetailed(false);
      }
    }, [
      description,
      hasRequestedDetailed,
      i18n.language,
      isLoadingDetailed,
      panoId,
      t,
    ]);

    const handleRetryDetailed = useCallback(async () => {
      if (!panoId || isLoadingDetailed) return;

      setIsLoadingDetailed(true);
      setDetailedError(null);

      try {
        const result = await getLocationDetailedDescription(panoId, i18n.language);
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
        setIsLoadingDetailed(false);
      }
    }, [i18n.language, isLoadingDetailed, panoId, t]);

    useEffect(() => {
      setDetailedDescription(null);
      setDetailedCitations(null);
      setDetailedError(null);
      setHasRequestedDetailed(false);
      setIsLoadingDetailed(false);
    }, [panoId]);

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

        <div className="ai-description-body">
          {shouldShowLoading ? (
            <div className="ai-loading-container">
              <ThinkingIcon />
              <div className="loading-message">
                {retries > 0
                  ? t("ai.retrying", { retries })
                  : loadingHint || t("ai.waitingForAnalysis")}
              </div>
            </div>
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

              {!hasRequestedDetailed && !detailedDescription && (
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
                <div className="detailed-loading-container">
                  <ThinkingIcon />
                  <div className="loading-message">
                    {t("ai.loadingDetailedDescription")}
                  </div>
                </div>
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
    prevProps.panoId === nextProps.panoId,
);

export default AiDescription;

import React, { memo, useState, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { buttonStyle } from "../styles/HomePage.styles";
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

const AiDescription = memo(
  function AiDescription({
    isLoading,
    error,
    description,
    retries,
    panoId,
    onRetry,
  }) {
    const { t, i18n } = useTranslation();

    const [detailedDescription, setDetailedDescription] = useState(null);
    const [isLoadingDetailed, setIsLoadingDetailed] = useState(false);
    const [detailedError, setDetailedError] = useState(null);
    const [hasRequestedDetailed, setHasRequestedDetailed] = useState(false);

    const shouldShowLoading = isLoading || (panoId && !description && !error);
    const loadingHint = useMemo(
      () => pickLoadingHint(i18n.language, panoId),
      [i18n.language, panoId],
    );

    const detectLanguage = (text) => {
      if (!text) return "en";
      const chineseChars = text.match(/[\u4e00-\u9fff]/g) || [];
      const totalChars = text.replace(/\s/g, "").length;
      return totalChars > 0 && chineseChars.length / totalChars > 0.3 ? "zh" : "en";
    };

    const ThinkingIcon = () => (
      <div className="thinking-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
        </svg>
      </div>
    );

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
      setDetailedError(null);
      setHasRequestedDetailed(false);
      setIsLoadingDetailed(false);
    }, [panoId]);

    return (
      <div className="ai-description">
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
            <div style={{ marginBottom: "8px" }}>{error}</div>
            <button
              onClick={onRetry}
              style={{
                ...buttonStyle,
                fontSize: "13px",
                padding: "6px 12px",
                backgroundColor: "#ef4444",
                borderColor: "#ef4444",
                borderRadius: "8px",
              }}
            >
              {t("ai.retryGetDescription")}
            </button>
          </div>
        ) : description ? (
          <div className="ai-content-container">
            <div
              className="ai-content"
              lang={detectLanguage(description)}
              style={{
                textAlign: i18n.language === "zh" ? "justify" : "left",
              }}
            >
              {description.split("\n").map((paragraph, index, parts) => {
                if (paragraph.trim() === "") return null;
                return (
                  <div
                    key={index}
                    style={{
                      marginBottom: index < parts.length - 1 ? "12px" : "0",
                    }}
                  >
                    {paragraph}
                  </div>
                );
              })}
            </div>

            {!hasRequestedDetailed && !detailedDescription && (
              <div className="tell-me-more-container">
                <button
                  className="tell-me-more-button"
                  onClick={handleTellMeMore}
                  disabled={isLoadingDetailed}
                >
                  <span className="button-icon">🔍</span>
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
                <div className="detailed-description-header">
                  <div className="detailed-title">
                    ✨ {t("ai.detailedAnalysisRequested")}
                  </div>
                </div>
                <div
                  className="detailed-content"
                  lang={detectLanguage(detailedDescription)}
                  style={{
                    textAlign: i18n.language === "zh" ? "justify" : "left",
                  }}
                >
                  {detailedDescription
                    .split("\n")
                    .map((paragraph, index, parts) => {
                      if (paragraph.trim() === "") return null;
                      return (
                        <div
                          key={index}
                          style={{
                            marginBottom: index < parts.length - 1 ? "16px" : "0",
                          }}
                        >
                          {paragraph}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="ai-no-data">{t("ai.cannotGetStreetView")}</div>
        )}
      </div>
    );
  },
  (prevProps, nextProps) =>
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.error === nextProps.error &&
    prevProps.description === nextProps.description &&
    prevProps.retries === nextProps.retries &&
    prevProps.panoId === nextProps.panoId,
);

export default AiDescription;

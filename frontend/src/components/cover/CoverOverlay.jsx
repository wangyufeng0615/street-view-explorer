import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  coverImageUrl,
  formatCoverCoord,
  markCoverSeen,
} from "../../utils/coverGate";
import "../../styles/CoverOverlay.css";

const LEAVE_MS = 900;

/**
 * 首次进入首页时叠在街景上的封面：一张满屏的高清卫星图、一行标题和出发按钮。
 * 首页照常在底下加载第一站；点"跟 Atlas 出发"（或空格、回车）后封面淡出，Esc 直接收起。
 *
 * @param {{
 *   place: import("../../utils/coverGate").CoverPlace,
 *   onClose: () => void,
 * }} props
 */
export default function CoverOverlay({ place, onClose }) {
  const { t, i18n } = useTranslation();
  const language = (i18n.resolvedLanguage || i18n.language || "en").startsWith(
    "zh",
  )
    ? "zh"
    : "en";
  const [imageReady, setImageReady] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const closedRef = useRef(false);
  const ctaRef = useRef(null);
  const imageUrl = coverImageUrl(place.id);

  // 图片加载完再淡入；加载失败时保留底色和标题，不挡用户出发
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setImageReady(true);
    };
    img.src = imageUrl;
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  useEffect(() => {
    ctaRef.current?.focus({ preventScroll: true });
  }, []);

  const leave = useCallback(() => {
    markCoverSeen();
    setLeaving(true);
  }, []);

  useEffect(() => {
    if (!leaving) return undefined;
    const timer = setTimeout(() => {
      if (closedRef.current) return;
      closedRef.current = true;
      onClose();
    }, LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving, onClose]);

  // 空格、回车出发，Esc 直接进入；首页的空格探索会因为 aria-modal 的对话框而让路
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape" || event.code === "Space") {
        event.preventDefault();
        leave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [leave]);

  const placeName = language === "zh" ? place.zh : place.en;
  // 中文标题在 "Atlas" 后换行（手机上折成两行时不会断在词中间）
  const tagline = t("site_tagline");
  const cut = tagline.indexOf("Atlas") + "Atlas".length;
  const lines =
    language === "zh" && cut > "Atlas".length - 1
      ? [tagline.slice(0, cut), tagline.slice(cut).trim()]
      : [tagline];

  return (
    <div
      className={`cover${imageReady ? " cover--ready" : ""}${leaving ? " cover--leaving" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={t("cover.dialog_label")}
    >
      <div
        className="cover__image"
        role="img"
        aria-label={placeName}
        style={{
          backgroundImage: imageReady ? `url(${imageUrl})` : undefined,
          "--cover-pos-mobile": place.posMobile || "center",
        }}
      />
      <div className="cover__shade" aria-hidden="true" />
      <div className="cover__frame" aria-hidden="true" />

      <span className="cover__mark" aria-hidden="true">
        ATLAS
      </span>
      <span className="cover__coord" title={placeName}>
        {formatCoverCoord(place.lat, place.lng)}
      </span>
      <span className="cover__credit">{t("cover.credit")}</span>

      <div className="cover__hero">
        <h1 className="cover__title">
          {lines.map((line, index) => (
            <React.Fragment key={line}>
              {index > 0 ? " " : null}
              <span className="cover__line">{line}</span>
            </React.Fragment>
          ))}
        </h1>
        <button
          ref={ctaRef}
          type="button"
          className="cover__cta"
          onClick={leave}
        >
          {t("cover.cta")}
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}

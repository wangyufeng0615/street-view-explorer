import React from "react";
import { useTranslation } from "react-i18next";

function reloadPage() {
  // 地址栏带着当前坐标，刷新后回到同一站，旅程也还在；街景脚本、各张卡片和小地图都会重新连一次
  window.location.reload();
}

/**
 * 街景整体用不了时盖在街景区域中间的说明：连不上 Google（unreachable），
 * 或 Google 拒绝了我们的密钥、额度（unavailable）。地名和来信照常显示，
 * 讲解来自我们自己的后端，不依赖 Google；手机字幕里已有"展开来信"，这里只放重试。
 */
export default function StreetViewNotice({ kind }) {
  const { t } = useTranslation();
  const prefix = kind === "unavailable" ? "unavailable" : "unreachable";
  return (
    <div className="home-sv-notice">
      <div
        className="home-arrival__card home-arrival__card--error home-panel"
        role="alert"
      >
        <span className="home-arrival__place">
          {t(`home.streetview.${prefix}Title`)}
        </span>
        <p className="home-arrival__error">
          {t(`home.streetview.${prefix}Body`)}
        </p>
        <div className="home-arrival__actions">
          <button
            type="button"
            className="home-button-primary home-arrival__retry"
            onClick={reloadPage}
          >
            {t("home.streetview.retry")}
          </button>
        </div>
      </div>
    </div>
  );
}

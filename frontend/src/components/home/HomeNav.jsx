import React, { memo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import useDismiss from "../../hooks/useDismiss";
import { writeLocalStorage } from "../../utils/safeStorage";
import { InfoGlyph, MenuGlyph } from "./HomeGlyphs";

const CONTACT_EMAIL = "alanwang424@gmail.com";
const WECHAT_ID = "807103724";

function LanguageToggle({ language, onChange }) {
  return (
    <div className="home-lang" role="group" aria-label="Language">
      {[
        ["zh", "中"],
        ["en", "EN"],
      ].map(([code, label]) => (
        <button
          key={code}
          type="button"
          className="home-lang__option"
          aria-pressed={language === code}
          onClick={() => onChange(code)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ContactList({ t }) {
  return (
    <dl className="home-contact">
      <dt>{t("contact.wechat")}</dt>
      <dd>{WECHAT_ID}</dd>
      <dt>{t("contact.email")}</dt>
      <dd>{CONTACT_EMAIL}</dd>
    </dl>
  );
}

const HomeNav = memo(function HomeNav({ onOpenFootprint }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [openPanel, setOpenPanel] = useState(null);
  const navRef = useRef(null);
  const language = (i18n.resolvedLanguage || i18n.language || "en").startsWith(
    "zh",
  )
    ? "zh"
    : "en";

  useDismiss(Boolean(openPanel), navRef, () => setOpenPanel(null));

  const changeLanguage = (code) => {
    if (code === language) return;
    writeLocalStorage("i18nextLng", code);
    i18n.changeLanguage(code);
  };

  const links = [
    { key: "explore", current: true },
    { key: "footprints", onClick: onOpenFootprint },
    { key: "guess", onClick: () => navigate("/guess") },
    { key: "odyssey", onClick: () => navigate("/agent") },
  ];

  const renderLinks = (className) =>
    links.map((link) => (
      <button
        key={link.key}
        type="button"
        className={className}
        aria-current={link.current ? "page" : undefined}
        onClick={() => {
          setOpenPanel(null);
          link.onClick?.();
        }}
      >
        {t(`home.nav.${link.key}`)}
      </button>
    ));

  const togglePanel = (panel) =>
    setOpenPanel((current) => (current === panel ? null : panel));

  return (
    <nav className="home-nav" aria-label={t("home.nav.label")}>
      <div className="home-nav__inner" ref={navRef}>
        <div className="home-nav__main home-bare">
          <span className="home-brand">{t("site_tagline")}</span>
          <div className="home-nav__links">{renderLinks("home-nav__link")}</div>
          <span className="home-nav__divider" aria-hidden="true" />
          <div className="home-nav__tools">
            <LanguageToggle language={language} onChange={changeLanguage} />
            <button
              type="button"
              className="home-icon-button"
              aria-label={t("contact_info")}
              aria-expanded={openPanel === "about"}
              onClick={() => togglePanel("about")}
            >
              <InfoGlyph />
            </button>
          </div>
          <button
            type="button"
            className="home-icon-button home-nav__menu-button"
            aria-label={t("home.nav.menu")}
            aria-expanded={openPanel === "menu"}
            onClick={() => togglePanel("menu")}
          >
            <MenuGlyph />
          </button>
        </div>

        {openPanel === "about" && (
          <div className="home-popover home-nav__about">
            <div className="home-popover__title">{t("contact_info")}</div>
            <ContactList t={t} />
          </div>
        )}

        {openPanel === "menu" && (
          <div className="home-popover home-nav__sheet">
            <div className="home-nav__sheet-links">
              {renderLinks("home-menu-item")}
            </div>
            <div className="home-popover__divider" />
            <div className="home-nav__sheet-row">
              <span className="home-popover__label">{t("language")}</span>
              <LanguageToggle language={language} onChange={changeLanguage} />
            </div>
            <div className="home-popover__divider" />
            <ContactList t={t} />
          </div>
        )}
      </div>
    </nav>
  );
});

export default HomeNav;

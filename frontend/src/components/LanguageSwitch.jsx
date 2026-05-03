import React from "react";
import { useTranslation } from "react-i18next";
import "../styles/LanguageSwitch.css";

const LANGUAGES = [
  { code: "en", label: "EN" },
  { code: "zh", label: "中" },
];

function normalizeLanguage(language) {
  return (language || "en").startsWith("zh") ? "zh" : "en";
}

export default function LanguageSwitch({ className = "", tone = "light" }) {
  const { t, i18n } = useTranslation();
  const currentLanguage = normalizeLanguage(
    i18n.resolvedLanguage || i18n.language,
  );

  const handleLanguageChange = (language) => {
    if (currentLanguage === language) return;
    if (typeof window !== "undefined") {
      window.localStorage?.setItem("i18nextLng", language);
    }

    i18n.changeLanguage(language).then(() => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("resize"));
      }
    });
  };

  return (
    <div
      className={`language-switch language-switch--${tone} ${className}`.trim()}
      role="group"
      aria-label={t("language")}
    >
      {LANGUAGES.map((language) => {
        const isActive = currentLanguage === language.code;
        return (
          <button
            key={language.code}
            type="button"
            className={`language-switch__button ${
              isActive ? "language-switch__button--active" : ""
            }`}
            aria-pressed={isActive}
            disabled={isActive}
            onClick={() => handleLanguageChange(language.code)}
          >
            {language.label}
          </button>
        );
      })}
    </div>
  );
}

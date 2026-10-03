import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en/translation.json";
import zh from "./locales/zh/translation.json";

const isTestEnvironment = import.meta.env.MODE === "test";

// Clean up legacy localStorage cache from previous versions
if (typeof window !== "undefined" && !isTestEnvironment) {
  try {
    const keysToRemove = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith("i18n_cache_")) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // ignore
  }
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    supportedLngs: ["en", "zh"],
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: isTestEnvironment ? ["navigator"] : ["localStorage", "navigator"],
      caches: isTestEnvironment ? [] : ["localStorage"],
    },
    returnObjects: true,
    react: {
      useSuspense: false,
    },
  });

// 浏览器按 <html lang> 为中文挑选字体和字形（简体/日文写法），读屏器也按它发音；
// 跟随界面语言更新，避免中文界面仍按英文处理
function syncDocumentLanguage(lng) {
  if (typeof document === "undefined" || !lng) return;
  document.documentElement.lang = lng.startsWith("zh") ? "zh-CN" : "en";
}
syncDocumentLanguage(i18n.resolvedLanguage || i18n.language);
i18n.on("languageChanged", syncDocumentLanguage);

export default i18n;

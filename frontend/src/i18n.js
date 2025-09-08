import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Cache management for translations
const CACHE_KEY_PREFIX = 'i18n_cache_';
const CACHE_VERSION = 'v1';
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

/**
 * Custom backend with localStorage caching
 */
const CachedHttpBackend = {
    type: 'backend',
    
    init: function(services, backendOptions, i18nextOptions) {
        this.services = services;
        this.options = backendOptions;
    },
    
    read: function(language, namespace, callback) {
        const cacheKey = `${CACHE_KEY_PREFIX}${CACHE_VERSION}_${language}_${namespace}`;
        
        // Try to get from cache first
        try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const { data, timestamp } = JSON.parse(cached);
                const now = Date.now();
                
                // Check if cache is still valid
                if (now - timestamp < CACHE_EXPIRY) {
                    // Use cached data
                    callback(null, data);
                    
                    // Optionally refresh cache in background if it's getting old (> 1 day)
                    if (now - timestamp > 24 * 60 * 60 * 1000) {
                        this.refreshInBackground(language, namespace, cacheKey);
                    }
                    
                    return;
                }
            }
        } catch (e) {
            console.warn('Failed to read from cache:', e);
        }
        
        // Fetch from network
        this.fetchTranslation(language, namespace, (err, data) => {
            if (!err && data) {
                // Save to cache
                try {
                    localStorage.setItem(cacheKey, JSON.stringify({
                        data,
                        timestamp: Date.now()
                    }));
                } catch (e) {
                    console.warn('Failed to save to cache:', e);
                    // Clean up old cache if storage is full
                    this.cleanupOldCache();
                }
            }
            callback(err, data);
        });
    },
    
    fetchTranslation: function(language, namespace, callback) {
        const url = `/locales/${language}/${namespace}.json`;
        
        fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => callback(null, data))
            .catch(err => callback(err, null));
    },
    
    refreshInBackground: function(language, namespace, cacheKey) {
        // Silently refresh cache in background
        this.fetchTranslation(language, namespace, (err, data) => {
            if (!err && data) {
                try {
                    localStorage.setItem(cacheKey, JSON.stringify({
                        data,
                        timestamp: Date.now()
                    }));
                } catch (e) {
                    // Ignore errors in background refresh
                }
            }
        });
    },
    
    cleanupOldCache: function() {
        try {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(CACHE_KEY_PREFIX)) {
                    try {
                        const cached = JSON.parse(localStorage.getItem(key));
                        if (Date.now() - cached.timestamp > CACHE_EXPIRY) {
                            keysToRemove.push(key);
                        }
                    } catch (e) {
                        // Remove invalid entries
                        keysToRemove.push(key);
                    }
                }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key));
        } catch (e) {
            console.warn('Failed to cleanup cache:', e);
        }
    }
};

// Preload translations for better performance
const preloadTranslations = async () => {
    const languages = ['en', 'zh'];
    const namespace = 'translation';
    
    // Use requestIdleCallback if available
    const loadTranslation = (lang) => {
        const cacheKey = `${CACHE_KEY_PREFIX}${CACHE_VERSION}_${lang}_${namespace}`;
        
        // Check if already cached
        try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const { timestamp } = JSON.parse(cached);
                if (Date.now() - timestamp < CACHE_EXPIRY) {
                    return; // Already cached and valid
                }
            }
        } catch (e) {
            // Continue to fetch
        }
        
        // Prefetch translation
        fetch(`/locales/${lang}/${namespace}.json`)
            .then(response => response.json())
            .then(data => {
                try {
                    localStorage.setItem(cacheKey, JSON.stringify({
                        data,
                        timestamp: Date.now()
                    }));
                } catch (e) {
                    // Ignore storage errors
                }
            })
            .catch(() => {
                // Ignore fetch errors for preloading
            });
    };
    
    if ('requestIdleCallback' in window) {
        languages.forEach(lang => {
            window.requestIdleCallback(() => loadTranslation(lang), { timeout: 3000 });
        });
    } else {
        // Fallback: load after a delay
        setTimeout(() => {
            languages.forEach(loadTranslation);
        }, 2000);
    }
};

// Initialize i18next with cached backend
i18n
    .use(CachedHttpBackend)
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        supportedLngs: ['en', 'zh'],
        fallbackLng: 'en',
        debug: false,
        interpolation: {
            escapeValue: false,
        },
        detection: {
            order: ['localStorage', 'navigator'],
            caches: ['localStorage'],
        },
        returnObjects: true,
        
        // React suspense config for better loading
        react: {
            useSuspense: true,
            bindI18n: 'languageChanged loaded',
            bindI18nStore: 'added removed',
            transEmptyNodeValue: '',
            transSupportBasicHtmlNodes: true,
            transKeepBasicHtmlNodesFor: ['br', 'strong', 'i'],
        },
    });

// Start preloading translations after init
if (typeof window !== 'undefined') {
    window.addEventListener('load', () => {
        // Delay preloading to not interfere with initial page load
        setTimeout(preloadTranslations, 1500);
    });
}

export default i18n;

import {resolveLocale, translate, type AppLocale, type LanguagePreference} from '../shared/i18n';

let currentLocale: AppLocale = 'zh-CN';
let systemLocale = navigator.language;
let initialized = false;
export const locale = () => currentLocale;
export const t = (message: string, values?: Record<string, string | number>) => translate(currentLocale, message, values);

export function setLocale(value: AppLocale): boolean {
  const changed = currentLocale !== value;
  currentLocale = value;
  document.documentElement.lang = value;
  if (changed || !initialized) applyTranslations();
  initialized = true;
  return changed;
}

export function configureLanguage(language: LanguagePreference, system?: string): boolean {
  if (system) systemLocale = system;
  return setLocale(resolveLocale(language, systemLocale));
}

/** Update text nodes and accessible labels without rebuilding controls or focus. */
export function applyTranslations(): void {
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n!);
  }
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n-aria]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nAria!));
  }
}

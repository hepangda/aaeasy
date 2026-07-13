export async function setLocaleAction(locale: string): Promise<void> {
  if (locale !== 'zh' && locale !== 'en') return;
  localStorage.setItem('aaeasy_locale', locale);
  document.cookie = `aaeasy_locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  window.location.reload();
}

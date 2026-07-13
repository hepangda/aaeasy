(() => {
  try {
    const stored = localStorage.getItem('theme');
    const theme = stored === 'light' || stored === 'dark' ? stored : 'system';
    const resolved =
      theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : theme === 'system'
          ? 'light'
          : theme;
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.style.colorScheme = resolved;
  } catch {
    // The React provider applies the theme after mount if storage is unavailable.
  }
})();

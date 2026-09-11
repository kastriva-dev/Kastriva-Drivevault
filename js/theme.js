/* theme.js — Dark / Light / System, persist di localStorage (default: dark). */
(function () {
  'use strict';
  const KEY = 'gfm.theme.v1';
  const mq = window.matchMedia('(prefers-color-scheme: dark)');

  function get() {
    try { return localStorage.getItem(KEY) || 'dark'; } catch { return 'dark'; }
  }

  function apply() {
    const t = get();
    const eff = t === 'system' ? (mq.matches ? 'dark' : 'light') : t;
    document.documentElement.dataset.theme = eff;
    document.documentElement.style.colorScheme = eff;
    document.querySelectorAll('.theme-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.theme === t);
    });
  }

  window.MMTheme = { get, apply };

  mq.addEventListener('change', () => { if (get() === 'system') apply(); });

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.theme-btn').forEach((b) => {
      b.addEventListener('click', () => {
        try { localStorage.setItem(KEY, b.dataset.theme); } catch {}
        apply();
      });
    });
    apply();
  });
})();

// Register the service worker (versioned cache + offline) and, when a new build
// is deployed, surface a small "reload to update" toast. Shared by reader.html
// and library.html so the registration + update flow lives in one place.

import { t } from './i18n.js';

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast(reg);
        });
      });
    }).catch(() => {});
    // Reload only on a genuine update takeover (a NEW worker replacing the one
    // that controlled this page). On a first visit the fresh worker's
    // clients.claim() also fires controllerchange — reloading there yanked the
    // page out from under the reader seconds after it loaded.
    let hadController = !!navigator.serviceWorker.controller;
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) { hadController = true; return; }
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
  });
}

function showUpdateToast(reg) {
  if (document.getElementById('sw-update-toast')) return;
  const t = document.createElement('div');
  t.id = 'sw-update-toast';
  t.style.cssText = 'position:fixed;left:50%;bottom:1.25rem;transform:translateX(-50%);z-index:10000;background:#222;color:#fff;padding:.6rem .9rem;border-radius:.6rem;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);display:flex;gap:.75rem;align-items:center;';
  const msg = document.createElement('span');
  msg.textContent = t('sw.newVersion');
  const btn = document.createElement('button');
  btn.textContent = t('sw.reload');
  btn.style.cssText = 'background:#4a8;color:#04130c;border:0;padding:.35rem .7rem;border-radius:.4rem;font:inherit;font-weight:600;cursor:pointer;';
  btn.addEventListener('click', () => { if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING'); t.remove(); });
  t.appendChild(msg);
  t.appendChild(btn);
  document.body.appendChild(t);
}

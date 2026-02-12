let mobileNavKeydownHandler = null;
let navLoadInFlight = null;
let activePageKey = null;
const scriptLoaders = new Map();
window.__pageRegistry = window.__pageRegistry || {};

function setupMobileDrawer(container) {
  const toggleBtn = container.querySelector('#mobile-nav-toggle');
  const closeBtn = container.querySelector('#mobile-nav-close');
  const overlay = container.querySelector('#mobile-nav-overlay');
  const drawer = container.querySelector('#mobile-nav-drawer');
  if (!toggleBtn || !overlay || !drawer) return;

  let isOpen = false;
  let hideTimer = null;

  const closeDrawer = () => {
    if (!isOpen) return;
    isOpen = false;
    toggleBtn.setAttribute('aria-expanded', 'false');
    overlay.classList.remove('is-open');
    drawer.classList.remove('is-open');
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      overlay.classList.add('hidden');
      drawer.classList.add('hidden');
      drawer.setAttribute('aria-hidden', 'true');
      overlay.setAttribute('aria-hidden', 'true');
      hideTimer = null;
    }, 180);
  };

  const openDrawer = () => {
    if (isOpen) return;
    isOpen = true;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    toggleBtn.setAttribute('aria-expanded', 'true');
    overlay.classList.remove('hidden');
    drawer.classList.remove('hidden');
    drawer.setAttribute('aria-hidden', 'false');
    overlay.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      overlay.classList.add('is-open');
      drawer.classList.add('is-open');
    });
  };

  const toggleDrawer = () => {
    if (isOpen) closeDrawer();
    else openDrawer();
  };

  toggleBtn.addEventListener('click', toggleDrawer);
  closeBtn?.addEventListener('click', closeDrawer);
  overlay.addEventListener('click', closeDrawer);
  drawer.querySelectorAll('a[data-nav]').forEach((link) => {
    link.addEventListener('click', closeDrawer);
  });

  if (mobileNavKeydownHandler) {
    document.removeEventListener('keydown', mobileNavKeydownHandler);
  }
  mobileNavKeydownHandler = (event) => {
    if (event.key === 'Escape') closeDrawer();
  };
  document.addEventListener('keydown', mobileNavKeydownHandler);
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) closeDrawer();
  });
}

function updateActiveNav(container, path) {
  const links = container.querySelectorAll('a[data-nav]');
  links.forEach((link) => {
    const target = link.getAttribute('data-nav') || '';
    if (target && path.startsWith(target)) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
}

function ensureRegistry() {
  if (!window.__pageRegistry) window.__pageRegistry = {};
  return window.__pageRegistry;
}

function getPageKeyByPath(pathname) {
  const path = String(pathname || '');
  if (path.startsWith('/admin/token')) return 'token';
  if (path.startsWith('/admin/keys')) return 'keys';
  if (path.startsWith('/admin/chat')) return 'chat';
  if (path.startsWith('/admin/datacenter')) return 'datacenter';
  if (path.startsWith('/admin/config')) return 'config';
  if (path.startsWith('/admin/cache')) return 'cache';
  if (path.startsWith('/token/token')) return 'token';
  if (path.startsWith('/keys/keys')) return 'keys';
  if (path.startsWith('/chat/chat_admin')) return 'chat';
  if (path.startsWith('/datacenter/datacenter')) return 'datacenter';
  if (path.startsWith('/config/config')) return 'config';
  if (path.startsWith('/cache/cache')) return 'cache';
  return null;
}

function normalizeAdminPath(pathname) {
  const path = String(pathname || '');
  if (path.startsWith('/token/token')) return '/admin/token';
  if (path.startsWith('/keys/keys')) return '/admin/keys';
  if (path.startsWith('/chat/chat_admin')) return '/admin/chat';
  if (path.startsWith('/datacenter/datacenter')) return '/admin/datacenter';
  if (path.startsWith('/config/config')) return '/admin/config';
  if (path.startsWith('/cache/cache')) return '/admin/cache';
  return path;
}

function runPageCleanup(pageKey) {
  if (!pageKey) return;
  const registry = ensureRegistry();
  const entry = registry[pageKey];
  if (entry && typeof entry.cleanup === 'function') {
    try { entry.cleanup(); } catch (e) {}
  }
}

function runPageInit(pageKey) {
  if (!pageKey) return;
  const registry = ensureRegistry();
  const entry = registry[pageKey];
  if (entry && typeof entry.init === 'function') {
    entry.init();
  }
}

function collectPageAssets(doc) {
  return {
    styles: Array.from(doc.querySelectorAll('link[data-page]')),
    scripts: Array.from(doc.querySelectorAll('script[data-page]')),
  };
}

function ensurePageAssets(assets) {
  const head = document.head || document.documentElement;
  assets.styles.forEach((link) => {
    const href = link.getAttribute('href') || '';
    if (!href) return;
    const existing = document.querySelector(`link[rel="stylesheet"][href="${href}"]`);
    if (existing) {
      existing.setAttribute('data-page', link.getAttribute('data-page') || '');
      return;
    }
    const clone = document.createElement('link');
    Array.from(link.attributes).forEach((attr) => clone.setAttribute(attr.name, attr.value));
    head.appendChild(clone);
  });

  const scriptPromises = assets.scripts.map((script) => {
    const src = script.getAttribute('src') || '';
    if (!src) return Promise.resolve();
    if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
    if (scriptLoaders.has(src)) return scriptLoaders.get(src);
    const promise = new Promise((resolve, reject) => {
      const clone = document.createElement('script');
      Array.from(script.attributes).forEach((attr) => clone.setAttribute(attr.name, attr.value));
      clone.onload = () => resolve();
      clone.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.body.appendChild(clone);
    });
    scriptLoaders.set(src, promise);
    return promise;
  });

  return Promise.all(scriptPromises);
}

function getPageContainer(doc) {
  return doc.querySelector('#app-page') || doc.querySelector('main');
}

async function loadAdminPage(url, pushState) {
  if (navLoadInFlight) navLoadInFlight.abort();
  navLoadInFlight = new AbortController();
  try {
    const res = await fetch(url, { cache: 'no-store', signal: navLoadInFlight.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const finalUrl = new URL(res.url || url, window.location.origin);
    const finalPath = finalUrl.pathname || window.location.pathname;
    const finalSearch = finalUrl.search || '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const nextContainer = getPageContainer(doc);
    const currentContainer = document.querySelector('#app-page') || document.querySelector('main');
    if (!nextContainer || !currentContainer) {
      window.location.href = url;
      return;
    }
    runPageCleanup(activePageKey);
    const assets = collectPageAssets(doc);
    document.title = doc.title || document.title;
    document.body.className = doc.body.className || document.body.className;
    currentContainer.replaceWith(nextContainer);
    window.__adminQuery = finalSearch || window.location.search || '';
    const normalizedPath = normalizeAdminPath(finalPath);
    const nextUrl = `${normalizedPath}${finalSearch}`;
    if (pushState) {
      window.history.pushState({}, '', nextUrl);
    } else if (normalizedPath !== window.location.pathname || finalSearch !== window.location.search) {
      window.history.replaceState({}, '', nextUrl);
    }
    await ensurePageAssets(assets);
    const header = document.getElementById('app-header');
    if (header) updateActiveNav(header, normalizedPath);
    activePageKey = getPageKeyByPath(normalizedPath);
    runPageInit(activePageKey);
  } catch (e) {
    if (e?.name === 'AbortError') return;
    window.location.href = url;
  }
}

async function loadAdminHeader() {
  const container = document.getElementById('app-header');
  if (!container) return;
  try {
    const res = await fetch('/static/common/header.html?v=4', { cache: 'no-store' });
    if (!res.ok) return;
    container.innerHTML = await res.text();
    updateActiveNav(container, window.location.pathname);
    setupMobileDrawer(container);
    if (typeof updateStorageModeButton === 'function') {
      updateStorageModeButton();
    }
    window.__adminQuery = window.location.search || '';
    activePageKey = getPageKeyByPath(window.location.pathname);
    runPageInit(activePageKey);
    container.querySelectorAll('a[data-nav]').forEach((link) => {
      link.addEventListener('click', (event) => {
        const href = link.getAttribute('href') || '';
        if (!href || href.startsWith('http')) return;
        event.preventDefault();
        const target = new URL(href, window.location.origin);
        if (!target.search && window.location.search) {
          target.search = window.location.search;
        }
        if (target.pathname === window.location.pathname && target.search === window.location.search) return;
        loadAdminPage(target.toString(), true);
      });
    });
  } catch (e) {
    // Fail silently to avoid breaking page load
  }
}

window.addEventListener('popstate', () => {
  const path = window.location.pathname;
  if (!path.startsWith('/admin/')) return;
  loadAdminPage(path, false);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadAdminHeader);
} else {
  loadAdminHeader();
}

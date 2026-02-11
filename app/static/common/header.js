let mobileNavKeydownHandler = null;
let navLoadInFlight = null;

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

function collectPageAssets(doc) {
  return {
    styles: Array.from(doc.querySelectorAll('link[data-page]')),
    scripts: Array.from(doc.querySelectorAll('script[data-page]')),
  };
}

function replacePageAssets(assets) {
  document.querySelectorAll('link[data-page]').forEach((el) => el.remove());
  document.querySelectorAll('script[data-page]').forEach((el) => el.remove());
  const head = document.head || document.documentElement;
  assets.styles.forEach((link) => {
    const clone = document.createElement('link');
    Array.from(link.attributes).forEach((attr) => clone.setAttribute(attr.name, attr.value));
    head.appendChild(clone);
  });
  assets.scripts.forEach((script) => {
    const clone = document.createElement('script');
    Array.from(script.attributes).forEach((attr) => clone.setAttribute(attr.name, attr.value));
    if (!script.src) {
      clone.textContent = script.textContent || '';
    }
    document.body.appendChild(clone);
  });
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
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const nextContainer = getPageContainer(doc);
    const currentContainer = document.querySelector('#app-page') || document.querySelector('main');
    if (!nextContainer || !currentContainer) {
      window.location.href = url;
      return;
    }
    if (typeof window.__pageCleanup === 'function') {
      try { window.__pageCleanup(); } catch (e) {}
    }
    const assets = collectPageAssets(doc);
    document.title = doc.title || document.title;
    document.body.className = doc.body.className || document.body.className;
    currentContainer.replaceWith(nextContainer);
    replacePageAssets(assets);
    if (pushState) window.history.pushState({}, '', url);
    const header = document.getElementById('app-header');
    if (header) updateActiveNav(header, window.location.pathname);
    if (typeof window.__pageInit === 'function') {
      window.__pageInit();
    }
  } catch (e) {
    if (e?.name === 'AbortError') return;
    window.location.href = url;
  }
}

async function loadAdminHeader() {
  const container = document.getElementById('app-header');
  if (!container) return;
  try {
    const res = await fetch('/static/common/header.html?v=3', { cache: 'no-store' });
    if (!res.ok) return;
    container.innerHTML = await res.text();
    updateActiveNav(container, window.location.pathname);
    setupMobileDrawer(container);
    if (typeof updateStorageModeButton === 'function') {
      updateStorageModeButton();
    }
    container.querySelectorAll('a[data-nav]').forEach((link) => {
      link.addEventListener('click', (event) => {
        const href = link.getAttribute('href') || '';
        if (!href || href.startsWith('http')) return;
        event.preventDefault();
        if (href === window.location.pathname) return;
        loadAdminPage(href, true);
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

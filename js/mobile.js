/* ═══════════════════════════════════════════════════════
   BICTS — mobile.js  v2 (bugfix)
   Load as LAST script in index.html and resident.html
═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const isMobile = () => window.innerWidth <= 768;

  /* ══════════════════════════════════════════════════════
     SIDEBAR DRAWER
  ══════════════════════════════════════════════════════ */
  function initSidebarDrawer() {
    const sidebar = $('sidebar');
    if (!sidebar) return;

    /* Create overlay */
    let overlay = $('sidebar-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sidebar-overlay';
      document.body.appendChild(overlay);
    }

    /* ── BUG FIX: hamburger must be the FIRST child of topbar
       so flex order is: [hamburger] [title] [actions...]
       Previously it was inserted before the title using
       insertBefore(hamburger, topbar.firstChild) which was
       correct, BUT the title had flex:1 and no min-width:0,
       meaning it stretched all the way to the right edge and
       its invisible overflow captured taps meant for the
       notification/user icons.
       The CSS fix (pointer-events:none on title + z-index:2
       on actions div) handles the tap-zone issue.
       Here we just make sure the DOM order is right. ── */
    let hamburger = $('hamburger-btn');
    if (!hamburger) {
      hamburger = document.createElement('button');
      hamburger.id = 'hamburger-btn';
      hamburger.setAttribute('aria-label', 'Open navigation menu');
      hamburger.setAttribute('aria-expanded', 'false');
      hamburger.setAttribute('type', 'button');
      hamburger.innerHTML = '<span></span><span></span><span></span>';

      const topbar = $('topbar');
      if (topbar) {
        /* Insert as first child so layout is: burger | title | actions */
        topbar.insertBefore(hamburger, topbar.firstChild);
      }
    }

    function openSidebar() {
      sidebar.classList.add('open');
      overlay.classList.add('visible');
      hamburger.classList.add('open');
      hamburger.setAttribute('aria-expanded', 'true');
      /* Don't set body overflow:hidden — it breaks iOS scroll position */
    }

    function closeSidebar() {
      sidebar.classList.remove('open');
      overlay.classList.remove('visible');
      hamburger.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
    }

    /* ── BUG FIX: use touchend instead of click on the hamburger.
       'click' on iOS fires ~300ms late AND sometimes misroutes to
       whatever element is underneath after the delay.
       touchend fires immediately and is reliable. ── */
    let _hammerTouchStarted = false;
    hamburger.addEventListener('touchstart', function (e) {
      _hammerTouchStarted = true;
      e.stopPropagation();
    }, { passive: true });

    hamburger.addEventListener('touchend', function (e) {
      if (!_hammerTouchStarted) return;
      _hammerTouchStarted = false;
      e.preventDefault();       /* prevent the ghost click */
      e.stopPropagation();
      sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
    });

    /* Fallback click for non-touch (desktop testing) */
    hamburger.addEventListener('click', function (e) {
      if (_hammerTouchStarted) return; /* already handled by touch */
      sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
    });

    /* Overlay tap → close */
    overlay.addEventListener('touchend', function (e) {
      e.preventDefault();
      closeSidebar();
    });
    overlay.addEventListener('click', closeSidebar);

    /* Nav item tap → close on mobile */
    sidebar.querySelectorAll('.nav-item').forEach(function (item) {
      item.addEventListener('click', function () {
        if (isMobile()) setTimeout(closeSidebar, 60);
      });
    });

    /* Swipe-left on sidebar → close */
    let _swX = 0, _swY = 0;
    sidebar.addEventListener('touchstart', function (e) {
      _swX = e.touches[0].clientX;
      _swY = e.touches[0].clientY;
    }, { passive: true });
    sidebar.addEventListener('touchend', function (e) {
      const dx = e.changedTouches[0].clientX - _swX;
      const dy = Math.abs(e.changedTouches[0].clientY - _swY);
      if (dx < -60 && dy < 60) closeSidebar();
    }, { passive: true });

    /* Swipe-right from left screen edge → open */
    let _edgeX = 0, _edgeY = 0;
    document.addEventListener('touchstart', function (e) {
      _edgeX = e.touches[0].clientX;
      _edgeY = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (_edgeX > 22) return;
      const dx = e.changedTouches[0].clientX - _edgeX;
      const dy = Math.abs(e.changedTouches[0].clientY - _edgeY);
      if (dx > 55 && dy < 80 && !sidebar.classList.contains('open')) openSidebar();
    }, { passive: true });

    window.addEventListener('resize', function () {
      if (!isMobile()) closeSidebar();
    });
  }

  /* ══════════════════════════════════════════════════════
     FLOATING ACTION BUTTON
  ══════════════════════════════════════════════════════ */
  function adminShellIsReady() {
    const shell = $('shell');
    return !!(
      shell &&
      window.CURRENT_USER &&
      (window.CURRENT_USER.role === 'admin' || window.CURRENT_USER.role === 'super_admin') &&
      window.getComputedStyle(shell).display !== 'none'
    );
  }

  function initFAB() {
    let fab = $('mobile-fab');

    // Never leave a floating + button on top of a hidden/unauthenticated shell.
    if (!adminShellIsReady()) {
      if (fab) fab.remove();
      return;
    }

    if (!fab) {
      fab = document.createElement('button');
      fab.id = 'mobile-fab';
      fab.setAttribute('type', 'button');
      fab.setAttribute('aria-label', 'Submit new complaint');
      fab.textContent = '+';
      document.body.appendChild(fab);

      fab.addEventListener('click', function () {
        if (typeof showModal === 'function') showModal('submitModal');
      });
    }
  }

  /* ══════════════════════════════════════════════════════
     MODAL SWIPE-DOWN TO CLOSE
  ══════════════════════════════════════════════════════ */
  function initModalSwipeClose() {
    document.querySelectorAll('.modal').forEach(function (modal) {
      let startY = 0;
      /* Only register swipe on the header/handle area, not the scrollable body */
      const header = modal.querySelector('.modal-header');
      const target = header || modal;
      target.addEventListener('touchstart', function (e) {
        startY = e.touches[0].clientY;
      }, { passive: true });
      target.addEventListener('touchend', function (e) {
        const dy = e.changedTouches[0].clientY - startY;
        if (dy > 80) {
          const overlay = modal.closest('.modal-overlay');
          if (overlay) overlay.classList.remove('open');
        }
      }, { passive: true });
    });
  }

  /* ══════════════════════════════════════════════════════
     TABLE SCROLL FADE HINTS
  ══════════════════════════════════════════════════════ */
  function initTableScrollHints() {
    document.querySelectorAll('.card-body.np').forEach(function (wrapper) {
      function update() {
        const atEnd = wrapper.scrollLeft + wrapper.clientWidth >= wrapper.scrollWidth - 6;
        wrapper.style.boxShadow = atEnd ? '' : 'inset -20px 0 14px -10px rgba(0,0,0,0.06)';
      }
      if (!wrapper._mobileHintBound) {
        wrapper.addEventListener('scroll', update, { passive: true });
        wrapper._mobileHintBound = true;
      }
      update();
    });
  }

  /* ══════════════════════════════════════════════════════
     iOS INPUT FIX
     BUG: inputs with font-size < 16px cause iOS Safari to
     zoom in on focus, shifting the layout.
     Also: touch-action:manipulation from the global * rule
     was preventing text cursor placement inside inputs on
     some iOS versions. We override it back to 'auto' here.
  ══════════════════════════════════════════════════════ */
  function fixInputs() {
    document.querySelectorAll('input, select, textarea').forEach(function (el) {
      /* font-size fix */
      const cs = window.getComputedStyle(el);
      if (parseFloat(cs.fontSize) < 16) el.style.fontSize = '16px';

      /* touch-action fix — allow normal text-selection gestures */
      el.style.touchAction = 'auto';

      /* user-select fix — iOS sometimes blocks tap-to-focus */
      el.style.webkitUserSelect = 'text';
      el.style.userSelect = 'text';
    });
  }

  /* ══════════════════════════════════════════════════════
     PATCH showScreen — re-apply fixes after navigation
  ══════════════════════════════════════════════════════ */
  function patchShowScreen() {
    if (typeof window.showScreen !== 'function') return;
    const _orig = window.showScreen;
    window.showScreen = function (id, navEl) {
      _orig(id, navEl);
      setTimeout(function () {
        initTableScrollHints();
        if (isMobile()) fixInputs();
      }, 100);
    };
  }

  /* ══════════════════════════════════════════════════════
     VIEWPORT HEIGHT (iOS Safari 100vh bug)
  ══════════════════════════════════════════════════════ */
  function fixViewportHeight() {
    function set() {
      document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px');
    }
    set();
    window.addEventListener('resize', set);
    window.addEventListener('orientationchange', function () { setTimeout(set, 250); });
  }

  // index.html dispatches this only after the authenticated shell is visible.
  document.addEventListener('barangai:admin-ready', function () {
    initFAB();
    if (isMobile()) fixInputs();
  });

  /* ══════════════════════════════════════════════════════
     BOOT
  ══════════════════════════════════════════════════════ */
  function init() {
    fixViewportHeight();
    initSidebarDrawer();
    if (adminShellIsReady()) initFAB();
    initModalSwipeClose();
    initTableScrollHints();
    patchShowScreen();
    if (isMobile()) fixInputs();

    /* Watch for dynamically added inputs (modals, etc.) */
    const obs = new MutationObserver(function () {
      initTableScrollHints();
      if (isMobile()) fixInputs();
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
/* DexDirect project page: progressive enhancements. The page reads fine without JS. */
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasIO = 'IntersectionObserver' in window;
  const onFrame = (fn) => { let queued = false; return () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fn(); }); }; };

  /* 1. Muted loop clips play only while on screen. */
  const clips = document.querySelectorAll('video[data-autoplay]');
  const onScreen = new WeakSet();
  if (reduceMotion || !hasIO) {
    clips.forEach((v) => {
      v.removeAttribute('autoplay');
      v.pause();
      if (!v.classList.contains('hero-video')) v.controls = true;
    });
  } else {
    const io = new IntersectionObserver((entries) => {
      for (const { target: v, isIntersecting } of entries) {
        if (isIntersecting) {
          onScreen.add(v);
          const p = v.play();
          if (p && p.catch) p.catch(() => { if (!v.classList.contains('hero-video')) v.controls = true; });
        } else {
          onScreen.delete(v);
          if (!v.paused) v.pause();
        }
      }
    }, { threshold: 0.25 });
    // From here on the observer decides when to play, so a later load() (see 10) does not autoplay off screen.
    clips.forEach((v) => { v.muted = true; v.controls = false; v.removeAttribute('autoplay'); io.observe(v); });
  }

  /* 2. Nav: transparent over the hero, solid once the hero scrolls away. */
  const nav = document.getElementById('nav');
  const hero = document.getElementById('top');
  if (nav) {
    const update = () => {
      const limit = hero ? hero.offsetHeight - nav.offsetHeight - 1 : 0;
      nav.classList.toggle('is-solid', window.scrollY > limit);
    };
    window.addEventListener('scroll', onFrame(update), { passive: true });
    window.addEventListener('resize', onFrame(update));
    update();
  }

  /* 3. Mobile menu drawer (<dialog>). */
  const menu = document.getElementById('menu');
  const openBtn = document.getElementById('menu-open');
  const closeBtn = document.getElementById('menu-close');
  if (menu && openBtn) {
    const open = () => { if (typeof menu.showModal === 'function') menu.showModal(); else menu.setAttribute('open', ''); };
    const close = () => { if (typeof menu.close === 'function') menu.close(); else menu.removeAttribute('open'); };
    openBtn.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    menu.addEventListener('click', (e) => {               // click on the backdrop closes
      const r = menu.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
    });
    menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
  }

  /* 4. Highlight the current section in the nav and the drawer. */
  const links = [...document.querySelectorAll('.nav-center a[href^="#"], .drawer-links a[href^="#"]')];
  if (hasIO && links.length) {
    const byId = new Map();
    links.forEach((a) => {
      const id = a.getAttribute('href').slice(1);
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(a);
    });
    const spy = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        links.forEach((a) => a.classList.remove('is-active'));
        (byId.get(e.target.id) || []).forEach((a) => a.classList.add('is-active'));   // the hero has no link: clears
      }
    }, { rootMargin: '-45% 0px -50% 0px' });
    byId.forEach((_, id) => { const s = document.getElementById(id); if (s) spy.observe(s); });
    if (hero) spy.observe(hero);
  }

  /* 5. Carousels: arrows, dots, and the active slide. */
  document.querySelectorAll('.carousel[id]').forEach((track) => {
    const slides = [...track.children];
    if (!slides.length) return;
    const prev = document.querySelector(`[data-carousel-prev="${track.id}"]`);
    const next = document.querySelector(`[data-carousel-next="${track.id}"]`);
    const dotsWrap = document.querySelector(`[data-carousel-dots="${track.id}"]`);
    const offset = (i) => slides[i].offsetLeft - slides[0].offsetLeft;
    const maxScroll = () => track.scrollWidth - track.clientWidth;
    const current = () => {
      if (track.scrollLeft >= maxScroll() - 2) return slides.length - 1;
      let best = 0;
      slides.forEach((_, i) => { if (Math.abs(offset(i) - track.scrollLeft) < Math.abs(offset(best) - track.scrollLeft)) best = i; });
      return best;
    };
    const go = (i) => {
      const n = Math.max(0, Math.min(slides.length - 1, i));
      track.scrollTo({ left: Math.min(offset(n), maxScroll()), behavior: reduceMotion ? 'auto' : 'smooth' });
    };
    const dots = slides.map((_, i) => {
      if (!dotsWrap) return null;
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.addEventListener('click', () => go(i));
      dotsWrap.appendChild(b);
      return b;
    });
    const update = () => {
      const i = current();
      dots.forEach((d, k) => d && d.classList.toggle('is-active', k === i));
      if (prev) prev.disabled = track.scrollLeft <= 2;
      if (next) next.disabled = track.scrollLeft >= maxScroll() - 2;
    };
    if (prev) prev.addEventListener('click', () => go(current() - 1));
    if (next) next.addEventListener('click', () => go(current() + 1));
    track.addEventListener('scroll', onFrame(update), { passive: true });
    window.addEventListener('resize', onFrame(update));
    update();
  });

  /* 6. Disabled placeholder links ("soon") do nothing. */
  document.querySelectorAll('a[aria-disabled="true"]').forEach((a) => {
    a.addEventListener('click', (e) => e.preventDefault());
  });

  /* 7. Copy BibTeX. */
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const src = document.querySelector(btn.dataset.copy);
      if (!src) return;
      const text = src.textContent.trim();
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        const range = document.createRange();
        range.selectNodeContents(src);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        try { ok = document.execCommand('copy'); } catch { ok = false; }
      }
      btn.textContent = ok ? 'Copied' : 'Press Ctrl+C';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
    });
  });

  /* 8. Hover / focus tooltip for the throughput bars. */
  const rows = document.querySelectorAll('.hbar-row[data-tip-value]');
  if (rows.length) {
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
    const place = (x, y) => {
      const pad = 12;
      const r = tip.getBoundingClientRect();
      let left = x + 14;
      let top = y - r.height - 12;
      if (left + r.width > window.innerWidth - pad) left = x - r.width - 14;
      if (top < pad) top = y + 18;
      tip.style.left = `${Math.max(pad, left)}px`;
      tip.style.top = `${top}px`;
    };
    const show = (row, x, y) => {
      const strong = document.createElement('strong');
      strong.textContent = row.dataset.tipValue;
      const span = document.createElement('span');
      span.textContent = row.dataset.tipLabel || '';
      tip.replaceChildren(strong, span);
      tip.hidden = false;
      place(x, y);
    };
    const hide = () => { tip.hidden = true; };
    rows.forEach((row) => {
      row.addEventListener('pointermove', (e) => show(row, e.clientX, e.clientY));
      row.addEventListener('pointerleave', hide);
      row.addEventListener('focus', () => {
        const r = (row.querySelector('.hbar-fill') || row).getBoundingClientRect();
        show(row, r.right, r.top);
      });
      row.addEventListener('blur', hide);
    });
    window.addEventListener('scroll', hide, { passive: true });
  }

  /* 9. Interactive 3D slot: lazy-load the viewer module near the viewport. */
  const slot = document.getElementById('viewer-3d');
  if (slot && slot.dataset.module) {
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      const url = new URL(slot.dataset.module, document.baseURI).href;
      // Browsers refuse module imports (and fetches) on pages opened from a file, so say how to view it instead.
      if (location.protocol === 'file:') {
        const p = slot.querySelector('.viewer-3d-placeholder p');
        if (p) p.innerHTML = 'Browsers do not run the simulation on a page opened as a file. In this folder run <code>python3 -m http.server</code>, then open <a href="http://localhost:8000/#explore-3d">localhost:8000</a>.';
        return;
      }
      import(url)
        .then((m) => (typeof m.mount === 'function' ? m.mount(slot) : undefined))
        .catch((err) => console.warn('[viewer-3d] could not load viewer module:', err));
    };
    if (hasIO) {
      const vo = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { vo.disconnect(); start(); }
      }, { rootMargin: '600px 0px' });
      vo.observe(slot);
    } else {
      start();
    }
  }

  /* 10. The hero has a portrait and a landscape cut, picked by <source media>. Browsers only evaluate that
         when the video loads, so reload it when the screen flips between the two (e.g. a phone is rotated). */
  const heroVideo = document.querySelector('.hero-video');
  if (heroVideo && window.matchMedia) {
    const sources = [...heroVideo.querySelectorAll('source')];
    const pick = () => sources.find((s) => (!s.media || window.matchMedia(s.media).matches)
      && (!s.type || heroVideo.canPlayType(s.type) !== ''));
    new Set(sources.filter((s) => s.media).map((s) => s.media)).forEach((query) => {
      const mq = window.matchMedia(query);
      const onChange = () => {
        const s = pick();
        if (!s || !heroVideo.currentSrc || s.src === heroVideo.currentSrc) return;
        heroVideo.load();
        if (!reduceMotion && onScreen.has(heroVideo)) heroVideo.play().catch(() => {});
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange); else mq.addListener(onChange);
    });
  }

  /* 11. Method walk-through. Once .is-live is set, CSS pins the clip band under the nav and the diagram under the
         band. The step whose top has crossed the reading line becomes active: data-active on .scrolly dims the
         other side of the clip, shows that hand's label and moves the diagram highlight. */
  const scrolly = document.getElementById('method-scrolly');
  const band = scrolly && scrolly.querySelector('.scrolly-video');
  const diagram = scrolly && scrolly.querySelector('.scrolly-diagram');
  const steps = scrolly ? [...scrolly.querySelectorAll('.step')] : [];
  if (band && diagram && steps.length) {
    const tabs = [...scrolly.querySelectorAll('[data-goto]')];
    const tabBar = scrolly.querySelector('.stage-tabs');
    const stacked = window.matchMedia('(max-width: 860px), (max-height: 599px)');   // same query as style.css
    let active = null;
    let pinnedBottom = 0;      // viewport y where the pinned part ends (the band; stacked, the diagram row too)

    scrolly.classList.add('is-live');
    if (tabBar) tabBar.hidden = false;

    const place = () => {
      const bandH = band.offsetHeight;
      scrolly.style.setProperty('--band-h', `${bandH}px`);
      pinnedBottom = (nav ? nav.offsetHeight : 0) + bandH + (stacked.matches ? diagram.offsetHeight : 0);
    };
    // The reading line sits a little above the middle of the space under the pinned part.
    const lineY = () => pinnedBottom + (window.innerHeight - pinnedBottom) * 0.45;

    const setStep = (step) => {
      if (step === active) return;
      active = step;
      const key = step.dataset.step;
      scrolly.dataset.active = key;
      steps.forEach((s) => s.classList.toggle('is-active', s === step));
      tabs.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.goto === key)));
    };
    const update = () => {
      const y = lineY();
      let pick = steps[0];
      for (const s of steps) if (s.getBoundingClientRect().top <= y) pick = s;
      setStep(pick);
    };

    // A tab brings its step's text up to just under the pinned part (if that still makes it the active one;
    // otherwise it centers the step on the reading line).
    tabs.forEach((b) => b.addEventListener('click', () => {
      const step = steps.find((s) => s.dataset.step === b.dataset.goto);
      if (!step) return;
      const r = step.getBoundingClientRect();
      const line = lineY();
      const textTop = (step.firstElementChild || step).getBoundingClientRect().top;
      let target = textTop - pinnedBottom - 24;
      if (!(r.top - target <= line && r.bottom - target > line)) target = r.top + r.height / 2 - line;
      window.scrollBy({ top: target, behavior: reduceMotion ? 'auto' : 'smooth' });
    }));

    window.addEventListener('scroll', onFrame(update), { passive: true });
    window.addEventListener('resize', onFrame(() => { place(); update(); }));
    place();
    update();
  }
})();

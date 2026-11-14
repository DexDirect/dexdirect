/* DexDirect project page: small progressive enhancements. Works without JS. */
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasIO = 'IntersectionObserver' in window;

  /* 1. Muted loop clips play only while on screen (saves CPU and bandwidth). */
  const clips = document.querySelectorAll('video[data-autoplay]');
  if (reduceMotion || !hasIO) {
    clips.forEach((v) => { v.removeAttribute('autoplay'); v.pause(); v.controls = true; });
  } else {
    const io = new IntersectionObserver((entries) => {
      for (const { target: v, isIntersecting } of entries) {
        if (isIntersecting) {
          const p = v.play();
          if (p && p.catch) p.catch(() => { v.controls = true; });
        } else if (!v.paused) {
          v.pause();
        }
      }
    }, { threshold: 0.25 });
    clips.forEach((v) => {
      v.muted = true;
      v.controls = false;
      io.observe(v);
    });
  }

  /* 2. Highlight the current section in the nav. */
  const navLinks = [...document.querySelectorAll('.nav-links a[href^="#"]')];
  if (hasIO && navLinks.length) {
    const byId = new Map(navLinks.map((a) => [a.getAttribute('href').slice(1), a]));
    const spy = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        navLinks.forEach((a) => a.classList.remove('is-active'));
        const link = byId.get(e.target.id);   // the hero (#top) has no link: clears the highlight
        if (link) {
          link.classList.add('is-active');
          const bar = link.parentElement;     // keep the active link visible in the scrollable mobile nav
          const br = bar.getBoundingClientRect(), lr = link.getBoundingClientRect();
          if (lr.left < br.left || lr.right > br.right) bar.scrollBy({ left: lr.left - br.left - 16, behavior: 'smooth' });
        }
      }
    }, { rootMargin: '-45% 0px -50% 0px' });
    byId.forEach((_, id) => { const s = document.getElementById(id); if (s) spy.observe(s); });
    const hero = document.getElementById('top');
    if (hero) spy.observe(hero);
  }

  /* 3. Disabled placeholder links ("soon") do nothing. */
  document.querySelectorAll('a[aria-disabled="true"]').forEach((a) => {
    a.addEventListener('click', (e) => e.preventDefault());
  });

  /* 4. Copy BibTeX. */
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
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        ta.remove();
      }
      btn.textContent = ok ? 'Copied' : 'Press Ctrl+C';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
    });
  });

  /* 5. Hover / focus tooltip for the throughput bars. */
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
        const fill = row.querySelector('.hbar-fill') || row;
        const r = fill.getBoundingClientRect();
        show(row, r.right, r.top);
      });
      row.addEventListener('blur', hide);
    });
    window.addEventListener('scroll', hide, { passive: true });
  }

  /* 6. Interactive 3D slot: lazy-load the viewer module when the slot nears the viewport. */
  const slot = document.getElementById('viewer-3d');
  if (slot && slot.dataset.module) {
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      const url = new URL(slot.dataset.module, document.baseURI).href;
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
})();

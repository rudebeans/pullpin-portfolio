/* ============================================
   MAIN.JS — Portfolio Interactions
   ============================================ */

(function () {
  'use strict';

  /* ---- NAV scroll state ---- */
  const nav = document.getElementById('nav');
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 60);
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---- CUSTOM CURSOR ---- */
  const cursor     = document.getElementById('cursor');
  const cursorDot  = cursor.querySelector('.cursor__dot');
  const cursorRing = cursor.querySelector('.cursor__ring');
  const cursorLabel = document.getElementById('cursorLabel');

  let mx = -100, my = -100;
  let rx = -100, ry = -100;

  document.addEventListener('mousemove', e => {
    mx = e.clientX;
    my = e.clientY;
    cursorDot.style.transform = `translate3d(${mx - 3}px, ${my - 3}px, 0)`;
  }, { passive: true });

  // Smooth ring follow — translate3d keeps it on GPU, no calc() string parsing
  function animateCursor() {
    rx += (mx - rx) * 0.12;
    ry += (my - ry) * 0.12;
    const tx = (rx - 18) | 0;
    const ty = (ry - 18) | 0;
    cursorRing.style.transform  = `translate3d(${tx}px, ${ty}px, 0)`;
    cursorLabel.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    requestAnimationFrame(animateCursor);
  }
  animateCursor();

  // Hover states
  document.querySelectorAll('[data-cursor]').forEach(el => {
    el.addEventListener('mouseenter', () => {
      cursor.classList.add('cursor--hover');
      cursorLabel.textContent = el.dataset.cursor;
    });
    el.addEventListener('mouseleave', () => {
      cursor.classList.remove('cursor--hover');
      cursorLabel.textContent = '';
    });
  });

  document.querySelectorAll('a, button').forEach(el => {
    el.addEventListener('mouseenter', () => cursor.classList.add('cursor--hover'));
    el.addEventListener('mouseleave', () => cursor.classList.remove('cursor--hover'));
  });

  /* ---- HERO BANNER ROTATOR ---- */
  const slides      = document.querySelectorAll('.hero__slide');
  const dots        = document.querySelectorAll('.hero__dot');
  const progressBar = document.getElementById('progressBar');
  const counter     = document.getElementById('slideCounter');
  const prevBtn     = document.getElementById('heroPrev');
  const nextBtn     = document.getElementById('heroNext');

  const SLIDE_DURATION = 7000; // ms — 7s per slide
  let current = 0;
  let timer = null;
  let progressStart = null;
  let progressRaf = null;
  let isPaused = false;

  function padNum(n) { return String(n + 1).padStart(2, '0'); }

  function goTo(index, restart = true) {
    slides[current].classList.remove('active');
    slides[current].classList.add('exit');
    dots[current].classList.remove('active');

    // Clear exit class after transition
    const prev = slides[current];
    setTimeout(() => prev.classList.remove('exit'), 1200);

    current = (index + slides.length) % slides.length;

    slides[current].classList.add('active');
    dots[current].classList.add('active');
    counter.textContent = `${padNum(current)} / ${padNum(slides.length - 1)}`;

    // Sync Three.js wireframe — play on slide 0, pause otherwise
    if (window.PullPinWireframe) {
      if (current === 0) PullPinWireframe.play();
      else               PullPinWireframe.pause();
    }

    if (restart) startProgress();
  }

  function startProgress() {
    cancelAnimationFrame(progressRaf);
    clearTimeout(timer);
    progressBar.style.transition = 'none';
    progressBar.style.width = '0%';
    progressStart = performance.now();

    function tick(now) {
      if (isPaused) { progressRaf = requestAnimationFrame(tick); return; }
      const elapsed = now - progressStart;
      const pct = Math.min((elapsed / SLIDE_DURATION) * 100, 100);
      progressBar.style.width = pct + '%';
      if (pct < 100) {
        progressRaf = requestAnimationFrame(tick);
      } else {
        timer = setTimeout(() => goTo(current + 1), 0);
      }
    }
    progressRaf = requestAnimationFrame(tick);
  }

  const heroEl = document.getElementById('hero');

  // Expose pause/resume so the wireframe drag can hold the carousel
  window.heroCarousel = {
    pause:  function () { isPaused = true; },
    resume: function () {
      isPaused = false;
      // Shift start time so progress bar continues from where it left off
      progressStart = performance.now() - (parseFloat(progressBar.style.width) / 100) * SLIDE_DURATION;
    }
  };

  // Dot nav
  dots.forEach((dot, i) => dot.addEventListener('click', () => goTo(i)));
  prevBtn.addEventListener('click', () => goTo(current - 1));
  nextBtn.addEventListener('click', () => goTo(current + 1));

  // Keyboard nav
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')  goTo(current - 1);
    if (e.key === 'ArrowRight') goTo(current + 1);
  });

  // Touch swipe
  let touchStartX = 0;
  heroEl.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
  heroEl.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) goTo(dx < 0 ? current + 1 : current - 1);
  }, { passive: true });

  /* ---- THREE.JS WIREFRAME — init + slide sync ---- */
  if (window.PullPinWireframe) {
    PullPinWireframe.init('wireframeMount');
    PullPinWireframe.play(); // slide 0 is active on load
  }

  startProgress();

  /* ---- SCROLL REVEAL ---- */
  const revealEls = document.querySelectorAll('.module, .about__inner, .contact__inner, .work__header');
  revealEls.forEach((el, i) => {
    el.classList.add('reveal');
    // Stagger cards in clusters
    const cluster = el.closest('.cluster--d, .cluster__stack, .cluster__row');
    if (cluster) {
      const siblings = Array.from(cluster.querySelectorAll('.module'));
      const idx = siblings.indexOf(el);
      if (idx > 0) el.style.transitionDelay = `${idx * 0.1}s`;
    }
  });

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        // Play any looping video inside the revealed module
        const vid = entry.target.querySelector('.module__video');
        if (vid) vid.play().catch(() => {});
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

  revealEls.forEach(el => revealObserver.observe(el));

  /* ---- MODULE VIDEO error fallback ---- */
  document.querySelectorAll('.module__video').forEach(v => {
    v.addEventListener('error', () => { v.style.display = 'none'; });
  });

  // Same for hero videos
  document.querySelectorAll('.hero__video').forEach(v => {
    v.addEventListener('error', () => { v.style.display = 'none'; });
  });

  // Hero images fallback
  document.querySelectorAll('.hero__img').forEach(img => {
    img.addEventListener('error', () => { img.style.display = 'none'; });
  });

  // Module images fallback
  document.querySelectorAll('.module__img').forEach(img => {
    img.addEventListener('error', () => { img.style.display = 'none'; });
  });

  /* ---- PARALLAX — subtle on hero ---- */
  /* Fix: apply to ALL .hero__media (not just active) so no jump on slide transition.
     Negative direction: media moves UP as user scrolls down (correct parallax). */
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        const sy = window.scrollY;
        // Skip the Three.js canvas slide — no transform needed there
        document.querySelectorAll('.hero__slide:not([data-index="0"]) .hero__media').forEach(m => {
          m.style.transform = `translateY(${-sy * 0.15}px)`;
        });
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });

  /* ---- SMOOTH ANCHOR SCROLL ---- */
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const target = document.querySelector(a.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  /* ---- STAGGER module entries on load ---- */
  window.addEventListener('load', () => {
    document.body.classList.add('loaded');
  });

})();

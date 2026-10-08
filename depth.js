(() => {
  const content = document.querySelector('#content');
  if (!content) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const hoverPointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const revealedCards = new Set();
  const cardSelector = '.social-overview, .partner-overview, .social-stages, .liquid-dept';
  const reveal = card => {
    revealedCards.add(card.getAttribute('aria-label'));
    card.classList.add('depth-revealed');
    // The final state is static. Refreshes and tab changes do not replay it.
    window.setTimeout(() => {
      if (card.isConnected) card.classList.remove('depth-pending');
    }, 1650);
  };
  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          reveal(entry.target);
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: .12 }) : null;

  function addColumnFaces(card) {
    card.querySelectorAll('.column-mark:not(.column-zero)').forEach((mark, index) => {
      if (mark.querySelector('.column-body')) return;
      const body = document.createElement('span');
      body.className = 'column-body';
      body.setAttribute('aria-hidden', 'true');
      body.style.setProperty('--column-delay', `${index * 110}ms`);
      for (const face of ['front', 'bottom', 'top']) {
        const element = document.createElement('span');
        element.className = `column-face column-${face}`;
        body.append(element);
      }
      mark.append(body);
    });
  }

  function bindTilt(card) {
    if (card.dataset.depthBound) return;
    card.dataset.depthBound = 'true';
    let frame = 0;
    let lastPoint;
    const clear = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      card.classList.remove('depth-hovering');
      for (const key of ['--depth-x', '--depth-y', '--depth-lift', '--light-x', '--light-y']) card.style.removeProperty(key);
    };
    card.addEventListener('pointermove', event => {
      if (!hoverPointer.matches || reducedMotion.matches || event.pointerType !== 'mouse') return;
      lastPoint = { x: event.clientX, y: event.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!card.isConnected) return;
        const box = card.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (lastPoint.x - box.left) / box.width));
        const y = Math.max(0, Math.min(1, (lastPoint.y - box.top) / box.height));
        card.style.setProperty('--depth-x', `${((.5 - y) * 4).toFixed(2)}deg`);
        card.style.setProperty('--depth-y', `${((x - .5) * 5).toFixed(2)}deg`);
        card.style.setProperty('--depth-lift', '-4px');
        card.style.setProperty('--light-x', `${(x * 100).toFixed(1)}%`);
        card.style.setProperty('--light-y', `${(y * 100).toFixed(1)}%`);
        card.classList.add('depth-hovering');
      });
    }, { passive: true });
    card.addEventListener('pointerleave', clear);
    card.addEventListener('pointercancel', clear);
    card.addEventListener('blur', clear, true);
  }

  function prepare() {
    observer?.disconnect();
    content.querySelectorAll(cardSelector).forEach(card => {
      addColumnFaces(card);
      bindTilt(card);
      if (!observer || reducedMotion.matches || revealedCards.has(card.getAttribute('aria-label'))) {
        card.classList.remove('depth-pending');
        card.classList.add('depth-revealed');
      } else {
        card.classList.add('depth-pending');
        observer.observe(card);
      }
      if (reducedMotion.matches) {
        card.classList.remove('depth-hovering');
        for (const key of ['--depth-x', '--depth-y', '--depth-lift', '--light-x', '--light-y']) card.style.removeProperty(key);
      }
    });
  }
  new MutationObserver(prepare).observe(content, { childList: true });
  reducedMotion.addEventListener('change', prepare);
  prepare();
})();

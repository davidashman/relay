/**
 * Send-to-thread glide animation.
 *
 * When a user sends a message, we smoothly glide the text (and any attachment
 * pills) from the input box up to their final position as the new user
 * message in the thread — an iMessage-style FLIP animation.
 *
 * Approach: capture source rects/content BEFORE the input clears, let the
 * message render normally, then mount absolutely-positioned "ghost" clones on
 * document.body and animate them via WAAPI from source to target. The real
 * targets are hidden via `visibility: hidden` during the flight, then
 * revealed on finish.
 */

export interface SendSnapshot {
  text: {
    rect: DOMRect;
    content: string;
    font: string;
    color: string;
    background: string;
    padding: string;
    borderRadius: string;
    lineHeight: string;
  } | null;
  attachments: Array<{
    rect: DOMRect;
    outerHTML: string;
  }>;
}

const GLIDE_DURATION_MS = 240;
const GLIDE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const ATTACHMENT_STAGGER_MS = 25;
const GHOST_Z_INDEX = 10000;

/**
 * Read the current visual state of the input so we can animate from it even
 * after it clears. Returns null if no text and no attachments are present.
 */
export function captureSourceSnapshot(
  inputRoot: HTMLElement | null | undefined
): SendSnapshot | null {
  if (!inputRoot) return null;

  const snapshot: SendSnapshot = { text: null, attachments: [] };

  const textEl = inputRoot.querySelector<HTMLElement>('.aislash-editor-input');
  const textContent = textEl?.innerText ?? '';
  if (textEl && textContent.trim().length > 0) {
    const rect = textEl.getBoundingClientRect();
    const cs = window.getComputedStyle(textEl);
    const pillEl = (inputRoot.classList.contains('full-input-box')
      ? inputRoot
      : (inputRoot.querySelector('.full-input-box') as HTMLElement | null)) ?? inputRoot;
    const pillStyle = window.getComputedStyle(pillEl);
    snapshot.text = {
      rect,
      content: textContent,
      font: cs.font,
      color: cs.color,
      background: pillStyle.backgroundColor,
      padding: pillStyle.padding,
      borderRadius: pillStyle.borderRadius,
      lineHeight: cs.lineHeight,
    };
  }

  const attachmentEls = inputRoot.querySelectorAll<HTMLElement>('.attachment-item');
  attachmentEls.forEach((el) => {
    snapshot.attachments.push({
      rect: el.getBoundingClientRect(),
      outerHTML: el.outerHTML,
    });
  });

  if (!snapshot.text && snapshot.attachments.length === 0) return null;
  return snapshot;
}

/**
 * Animate a captured snapshot onto the newly-rendered user message element.
 *
 * Two-phase flow to avoid a flash of the landing spot:
 *   Phase 1 — runs SYNCHRONOUSLY on call: finds the target sub-elements and
 *             sets `visibility: hidden` on them. Callers must invoke this
 *             right after `await nextTick()` so the browser never paints the
 *             newly-mounted message in its visible state.
 *   Phase 2 — the returned `play()` performs the actual glide. Callers
 *             should do any scroll/layout work before invoking it, so the
 *             measured target rects are final.
 *
 * Two variants:
 *   - 'thread': target is a `.user-message` — glide text into
 *     `.message-text > div:first-child` and attachments into `.attachment-tile`.
 *   - 'queue':  target is a `.queue-item` — glide text into the pill itself.
 *     The queue doesn't render attachments, so any captured attachment pills
 *     fade out in place rather than flying to a destination.
 *
 * If the user prefers reduced motion, this is a no-op (targets stay visible,
 * `play()` resolves immediately).
 */
export function prepareSendAnimation(
  snapshot: SendSnapshot,
  targetEl: HTMLElement,
  variant: 'thread' | 'queue' = 'thread'
): { play: () => Promise<void> } {
  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) {
    return { play: async () => {} };
  }

  // Resolve variant-specific elements.
  let textTarget: HTMLElement | null = null;
  let textStyleEl: HTMLElement | null = null;
  let pillStyleEl: HTMLElement | null = null;
  let attachmentTargets: HTMLElement[] = [];
  const elementsToHide: HTMLElement[] = [];

  if (variant === 'thread') {
    textTarget = snapshot.text
      ? targetEl.querySelector<HTMLElement>('.message-text > div:first-child')
      : null;
    textStyleEl = textTarget;
    pillStyleEl = textTarget?.parentElement ?? null;
    const contentWrapper = textTarget
      ? textTarget.closest<HTMLElement>('.message-content')
      : null;
    if (contentWrapper) elementsToHide.push(contentWrapper);
    attachmentTargets = Array.from(
      targetEl.querySelectorAll<HTMLElement>('.attachment-tile')
    ).slice(0, snapshot.attachments.length);
    elementsToHide.push(...attachmentTargets);
  } else {
    // 'queue': text flies into the pill; no attachment destination.
    textTarget = snapshot.text ? targetEl : null;
    textStyleEl = targetEl.querySelector<HTMLElement>('.aislash-editor-input-readonly') ?? targetEl;
    pillStyleEl = targetEl;
    elementsToHide.push(targetEl);
  }

  // --- Phase 1: hide synchronously so the next paint doesn't flash the
  // fully-rendered target before the ghost arrives.
  const hiddenEls: HTMLElement[] = [];
  const hide = (el: HTMLElement | null | undefined) => {
    if (!el) return;
    el.style.visibility = 'hidden';
    hiddenEls.push(el);
  };
  elementsToHide.forEach(hide);

  const restoreHidden = () => {
    for (const el of hiddenEls) {
      if (el.isConnected) el.style.visibility = '';
    }
  };

  // --- Phase 2: measure + animate. Must be called after any scroll/layout
  // work the caller intends to do.
  const play = async (): Promise<void> => {
    const ghosts: HTMLElement[] = [];
    const animations: Animation[] = [];

    try {
      // Text ghost
      if (snapshot.text && textTarget && textTarget.isConnected) {
        const src = snapshot.text;
        const dstRect = textTarget.getBoundingClientRect();
        const dstStyle = window.getComputedStyle(textStyleEl ?? textTarget);
        const dstParentStyle = pillStyleEl
          ? window.getComputedStyle(pillStyleEl)
          : dstStyle;

        const ghost = document.createElement('div');
        ghost.setAttribute('data-send-ghost', 'text');
        ghost.textContent = src.content;
        Object.assign(ghost.style, {
          position: 'fixed',
          left: `${src.rect.left}px`,
          top: `${src.rect.top}px`,
          width: `${src.rect.width}px`,
          minHeight: `${src.rect.height}px`,
          margin: '0',
          boxSizing: 'border-box',
          font: src.font,
          color: src.color,
          background: src.background,
          padding: src.padding,
          borderRadius: src.borderRadius,
          lineHeight: src.lineHeight,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowWrap: 'break-word',
          pointerEvents: 'none',
          zIndex: String(GHOST_Z_INDEX),
          willChange: 'left, top, width, padding, background, border-radius, font, line-height',
        } as Partial<CSSStyleDeclaration>);
        document.body.appendChild(ghost);
        ghosts.push(ghost);

        animations.push(ghost.animate(
          [
            {
              left: `${src.rect.left}px`,
              top: `${src.rect.top}px`,
              width: `${src.rect.width}px`,
              font: src.font,
              lineHeight: src.lineHeight,
              padding: src.padding,
              borderRadius: src.borderRadius,
              background: src.background,
              color: src.color,
            },
            {
              left: `${dstRect.left}px`,
              top: `${dstRect.top}px`,
              width: `${dstRect.width}px`,
              font: dstStyle.font,
              lineHeight: dstStyle.lineHeight,
              padding: dstStyle.padding,
              borderRadius: dstParentStyle.borderRadius,
              background: dstParentStyle.backgroundColor,
              color: dstStyle.color,
            },
          ],
          { duration: GLIDE_DURATION_MS, easing: GLIDE_EASING, fill: 'forwards' }
        ));
      }

      // Attachment ghosts.
      //   - 'thread': glide each source pill into its matching .attachment-tile.
      //   - 'queue':  queue items don't render attachments, so fade the source
      //               pills out in place with a slight upward drift.
      const attachmentCount = variant === 'thread'
        ? attachmentTargets.length
        : snapshot.attachments.length;
      for (let i = 0; i < attachmentCount; i++) {
        const src = snapshot.attachments[i];
        const target = variant === 'thread' ? attachmentTargets[i] : null;
        if (variant === 'thread' && (!target || !target.isConnected)) continue;

        const wrapper = document.createElement('div');
        wrapper.innerHTML = src.outerHTML.trim();
        const ghost = wrapper.firstElementChild as HTMLElement | null;
        if (!ghost) continue;

        ghost.setAttribute('data-send-ghost', 'attachment');
        Object.assign(ghost.style, {
          position: 'fixed',
          left: `${src.rect.left}px`,
          top: `${src.rect.top}px`,
          width: `${src.rect.width}px`,
          height: `${src.rect.height}px`,
          margin: '0',
          pointerEvents: 'none',
          zIndex: String(GHOST_Z_INDEX),
          willChange: variant === 'thread'
            ? 'left, top, width, height'
            : 'top, opacity',
        } as Partial<CSSStyleDeclaration>);
        document.body.appendChild(ghost);
        ghosts.push(ghost);

        if (variant === 'thread' && target) {
          const dstRect = target.getBoundingClientRect();
          animations.push(ghost.animate(
            [
              { left: `${src.rect.left}px`, top: `${src.rect.top}px`, width: `${src.rect.width}px`, height: `${src.rect.height}px` },
              { left: `${dstRect.left}px`, top: `${dstRect.top}px`, width: `${dstRect.width}px`, height: `${dstRect.height}px` },
            ],
            {
              duration: GLIDE_DURATION_MS,
              easing: GLIDE_EASING,
              delay: i * ATTACHMENT_STAGGER_MS,
              fill: 'forwards',
            }
          ));
        } else {
          // Queue path: no destination — fade out in place with a subtle lift.
          animations.push(ghost.animate(
            [
              { top: `${src.rect.top}px`, opacity: 1 },
              { top: `${src.rect.top - 8}px`, opacity: 0 },
            ],
            {
              duration: GLIDE_DURATION_MS,
              easing: GLIDE_EASING,
              delay: i * ATTACHMENT_STAGGER_MS,
              fill: 'forwards',
            }
          ));
        }
      }

      if (animations.length === 0) return;

      await Promise.allSettled(animations.map((a) => a.finished));
    } finally {
      restoreHidden();
      for (const ghost of ghosts) ghost.remove();
    }
  };

  return { play };
}

import { useEffect } from "react";

/**
 * Lock background page scroll while an overlay (modal / sheet / dropdown) is open,
 * so scrolling the overlay never drags the page behind it. iOS-safe: pins the
 * body with `position: fixed` and restores the exact scroll position on close
 * (plain `overflow: hidden` doesn't stop Safari's rubber-banding). Reference-
 * counted, so nested overlays don't unlock each other prematurely.
 */
let lockCount = 0;
let savedScrollY = 0;

export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (lockCount === 0) {
      savedScrollY = window.scrollY;
      const b = document.body.style;
      b.position = "fixed";
      b.top = `-${savedScrollY}px`;
      b.left = "0";
      b.right = "0";
      b.width = "100%";
      b.overflow = "hidden";
    }
    lockCount++;
    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        const b = document.body.style;
        b.position = ""; b.top = ""; b.left = ""; b.right = ""; b.width = ""; b.overflow = "";
        window.scrollTo(0, savedScrollY);
      }
    };
  }, [active]);
}

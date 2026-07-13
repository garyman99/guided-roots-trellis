import { useEffect } from "react";

/**
 * Brand reveal motion: elements with .gr-reveal fade + rise into place the
 * first time they enter the viewport (growth, not flash). Reduced-motion
 * users get the final state via the CSS contract in guided-roots.css.
 *
 * Content that arrives after mount (fetched course cards, re-filtered
 * scenario grids) is picked up by a MutationObserver — otherwise late
 * elements would never earn their `.in` class and stay hidden.
 */
export function useReveal(): void {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15 },
    );
    const observeAll = () =>
      document.querySelectorAll<HTMLElement>(".gr-reveal:not(.in)").forEach((el) => io.observe(el));
    observeAll();
    const mo = new MutationObserver(observeAll);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);
}

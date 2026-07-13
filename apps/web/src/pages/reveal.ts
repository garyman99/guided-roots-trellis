import { useEffect } from "react";

/**
 * Brand reveal motion: elements with .gr-reveal fade + rise into place the
 * first time they enter the viewport (growth, not flash). Reduced-motion
 * users get the final state via the CSS contract in guided-roots.css.
 */
export function useReveal(): void {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".gr-reveal"));
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
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

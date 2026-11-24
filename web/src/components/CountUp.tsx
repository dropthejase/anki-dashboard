import { useEffect, useRef, useState } from "react";

const DURATION_MS = 700;

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Counts from the previously shown number up to `value`. Shows the final number straight away if the viewer prefers reduced motion. */
export function CountUp({ value, ...rest }: { value: number } & React.HTMLAttributes<HTMLSpanElement>) {
  const [shown, setShown] = useState(() => (reducedMotion() ? value : 0));
  const from = useRef(shown);

  useEffect(() => {
    if (reducedMotion()) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(origin + (value - origin) * eased);
      from.current = next;
      setShown(next);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <span {...rest}>{shown}</span>;
}

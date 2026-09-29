import { useEffect, useRef } from "react";
import gsap from "gsap";

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Number that tweens from its previous value to the new one. Writes the DOM directly, no re-render per frame. */
export default function CountUp({ value, format = (n) => String(Math.round(n)), duration = 1 }: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
}) {
  const el = useRef<HTMLSpanElement>(null);
  const current = useRef({ n: 0 });
  // Callers often pass an inline formatter; a ref keeps it from restarting the tween every render
  const fmt = useRef(format);
  fmt.current = format;

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const format = fmt.current;
    if (reduceMotion()) {
      current.current.n = value;
      node.textContent = format(value);
      return;
    }
    const tween = gsap.to(current.current, {
      n: value,
      duration,
      ease: "power3.out",
      onUpdate: () => { node.textContent = format(current.current.n); },
    });
    return () => { tween.kill(); };
  }, [value, duration]);

  return <span ref={el}>{format(0)}</span>;
}

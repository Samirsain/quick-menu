// Shared pieces of the guest menu's look (the "Order Slip" world on the .guest palette).
// One Ticket Stamp per screen: PrimaryButton is only for the action that moves the meal forward.
import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { X } from "lucide-react";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const EASE = [0.22, 1, 0.36, 1] as const;
export const SHEET = "max-w-md w-[94vw] p-0 gap-0 rounded-[28px] overflow-hidden border border-menu-line bg-menu-bg text-menu-ink shadow-[0_30px_80px_-20px_rgba(14,17,22,0.4)] z-[200] outline-none";
export const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const inr = (n: number, paise = false) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: paise ? 2 : 0, minimumFractionDigits: paise ? 2 : 0 }).format(Number(n || 0));
/** Bills show paise only when there are some (₹41.73, but ₹876) */
export const money = (n: number) => inr(n, Math.round(n * 100) % 100 !== 0);

export const CloseButton = ({ onClick, label = "Close" }: { onClick: () => void; label?: string }) => (
  <button onClick={onClick} aria-label={label} className="h-9 w-9 -mr-2 rounded-full flex items-center justify-center text-menu-muted hover:text-menu-ink hover:bg-menu-ink/5 transition-colors">
    <X className="h-[18px] w-[18px]" strokeWidth={1.75} />
  </button>
);

export const SheetHeader = ({ title, onClose, action, sub }: { title: string; onClose: () => void; action?: React.ReactNode; sub?: React.ReactNode }) => (
  <DialogHeader className="px-6 pt-6 pb-2 space-y-0">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3 min-w-0">
        <DialogTitle className="font-display text-[26px] font-normal truncate">{title}</DialogTitle>
        {action}
      </div>
      <CloseButton onClick={onClose} />
    </div>
    {sub && <div className="text-left text-sm text-menu-muted">{sub}</div>}
  </DialogHeader>
);

export const PrimaryButton = ({ children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    {...props}
    className={`w-full h-12 rounded-2xl bg-gradient-to-r from-menu-accent to-menu-accent-2 dark:to-menu-accent text-[#FBF4EA] dark:text-menu-hero text-[15px] font-semibold flex items-center justify-center gap-2 shadow-[0_14px_30px_-14px_rgba(138,58,30,0.7)] active:scale-[0.99] disabled:opacity-40 disabled:shadow-none disabled:active:scale-100 transition-[transform,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-menu-accent focus-visible:ring-offset-2 focus-visible:ring-offset-menu-bg ${className}`}
  >
    {children}
  </button>
);

export const SecondaryButton = ({ children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    {...props}
    className={`w-full h-11 rounded-2xl border border-menu-line bg-menu-card/60 text-[14px] font-medium flex items-center justify-center gap-2 hover:border-menu-accent/40 disabled:opacity-40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-menu-accent ${className}`}
  >
    {children}
  </button>
);

/** Pill choices in a row (split type, tip). Selected = ink, not the stamp: the stamp stays for the pay button. */
export function Segmented<T extends string | number>({ value, options, onChange, label, className = "" }: {
  value: T; options: { value: T; label: React.ReactNode }[]; onChange: (v: T) => void; label: string; className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`h-10 px-4 flex-shrink-0 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-menu-accent ${
              on ? "bg-menu-ink text-menu-bg" : "bg-menu-ink/[0.05] text-menu-ink/75 hover:bg-menu-ink/[0.09]"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export const inputClass = "w-full h-11 px-4 rounded-xl border border-menu-line bg-menu-card text-[15px] text-menu-ink placeholder:text-menu-muted outline-none focus:border-menu-accent focus:ring-1 focus:ring-menu-accent transition-colors";

/** − n + for small counts (people at the table, how many of a dish are yours) */
export const Stepper = ({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) => (
  <div className="inline-flex items-center h-10 rounded-full bg-menu-tint text-menu-accent-2 dark:text-menu-accent" role="group" aria-label={label}>
    <button type="button" aria-label={`Fewer: ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)} className="h-10 w-10 flex items-center justify-center text-lg font-semibold disabled:opacity-30">−</button>
    <span className="min-w-6 text-center text-[15px] font-semibold tabular-nums" aria-live="polite">{value}</span>
    <button type="button" aria-label={`More: ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)} className="h-10 w-10 flex items-center justify-center text-lg font-semibold disabled:opacity-30">+</button>
  </div>
);

// Check mark that draws itself (GSAP stroke animation)
export const DrawnCheck = ({ className = "w-16 h-16 mx-auto text-menu-accent" }: { className?: string }) => {
  const ref = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    if (!ref.current || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.timeline()
        .from("circle", { strokeDashoffset: 157, duration: 0.8, ease: "power2.inOut" })
        .from("path", { strokeDashoffset: 40, duration: 0.45, ease: "power2.out" }, "-=0.2");
    }, ref);
    return () => ctx.revert();
  }, []);
  return (
    <svg ref={ref} viewBox="0 0 56 56" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="28" cy="28" r="25" strokeDasharray="157" strokeDashoffset="0" />
      <path d="M18 29l7 7 13-15" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="40" strokeDashoffset="0" />
    </svg>
  );
};

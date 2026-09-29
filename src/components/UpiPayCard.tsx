import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Check, Copy } from "lucide-react";
import CountUp from "@/components/CountUp";

const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

/**
 * Bill amount + "Pay with UPI" deep link. The phone's UPI app (GPay/PhonePe/Paytm) opens with payee and amount filled.
 * ponytail: no payment confirmation - staff checks their UPI app; auto-confirm needs a payment gateway webhook.
 */
export default function UpiPayCard({ upiId, payee, amount, note }: { upiId: string; payee: string; amount: number; note: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      gsap.from("[data-anim]", { y: 14, opacity: 0, duration: 0.55, ease: "power3.out", stagger: 0.07 });
    }, root);
    return () => ctx.revert();
  }, []);

  // upiId is validated to [A-Za-z0-9._-]@letters on save, so it goes in raw (some apps reject an encoded "@")
  const href = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(payee)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;

  const copy = () => {
    navigator.clipboard?.writeText(upiId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  };

  return (
    <div ref={root} className="rounded-[20px] border border-menu-line bg-menu-card p-4">
      <div data-anim className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-menu-muted">Your bill</span>
        <span className="font-display text-[28px] tabular-nums text-menu-ink"><CountUp value={amount} format={inr} duration={0.8} /></span>
      </div>
      <a
        data-anim
        href={href}
        onPointerDown={(e) => gsap.to(e.currentTarget, { scale: 0.97, duration: 0.12 })}
        onPointerUp={(e) => gsap.to(e.currentTarget, { scale: 1, duration: 0.35, ease: "back.out(3)" })}
        onPointerLeave={(e) => gsap.to(e.currentTarget, { scale: 1, duration: 0.2 })}
        className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-menu-accent to-menu-accent-2 text-[15px] font-semibold text-[#FBF4EA] shadow-[0_14px_30px_-14px_rgba(138,58,30,0.7)]"
      >
        Pay {inr(amount)} with UPI
      </a>
      <button
        data-anim
        type="button"
        onClick={copy}
        className="mt-2 flex w-full items-center justify-center gap-1.5 py-1.5 text-xs text-menu-muted hover:text-menu-ink transition-colors"
        aria-label={`Copy UPI ID ${upiId}`}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : <>or pay to <span className="font-medium text-menu-ink">{upiId}</span></>}
      </button>
    </div>
  );
}

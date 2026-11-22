// "While you wait": Spin & Win, loyalty points and the guest WiFi, shown once the table has ordered.
import { useState } from "react";
import { Check, Copy, Gift, Loader2, Wifi } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { errorCopy, type Loyalty, type SpinPrize, type TableState } from "@/lib/tableService";
import type { TableSeat } from "@/hooks/useTableSeat";
import { CloseButton, PrimaryButton, SHEET, inputClass, prefersReducedMotion } from "@/components/guest/ui";

export default function WaitPanel({ seat }: { seat: TableSeat }) {
  const st = seat.state;
  const [spinOpen, setSpinOpen] = useState(false);
  if (!st || st.status !== "open" || st.orders.length === 0) return null;
  const hasSpin = st.spin_prizes.length > 0;
  if (!hasSpin && !st.loyalty && !st.wifi) return null;

  return (
    <section className="mb-10" aria-labelledby="wait-title">
      <h2 id="wait-title" className="font-display text-[22px] leading-tight">While you wait</h2>
      <div className="mt-3 -mx-4 px-4 scroll-px-4 lg:mx-0 lg:px-0 flex lg:grid lg:grid-cols-3 gap-3 overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {hasSpin && (
          <button
            onClick={() => setSpinOpen(true)}
            className="snap-start flex-shrink-0 w-[min(78vw,300px)] lg:w-auto text-left rounded-[20px] border border-menu-line bg-menu-card p-4 flex items-center gap-4 hover:border-menu-accent/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-menu-accent"
          >
            <MiniWheel n={st.spin_prizes.length} />
            <span className="min-w-0">
              <span className="block font-medium">{st.spin ? `You won: ${st.spin.label}` : "Spin & win"}</span>
              <span className="block mt-0.5 text-sm text-menu-muted">{st.spin ? "Tap to see how to claim it" : "One spin for your table"}</span>
            </span>
          </button>
        )}
        {st.loyalty && <LoyaltyCard seat={seat} loyalty={st.loyalty} className="snap-start flex-shrink-0 w-[min(78vw,300px)] lg:w-auto" />}
        {st.wifi && <WifiCard wifi={st.wifi} className="snap-start flex-shrink-0 w-[min(78vw,300px)] lg:w-auto" />}
      </div>
      {hasSpin && <SpinDialog open={spinOpen} onOpenChange={setSpinOpen} seat={seat} state={st} />}
    </section>
  );
}

export function LoyaltyCard({ seat, loyalty, className = "", earning }: { seat: TableSeat; loyalty: Loyalty; className?: string; earning?: number }) {
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const points = loyalty.points ?? 0;
  const pct = Math.min(100, (points / Math.max(loyalty.goal, 1)) * 100);
  const join = async () => {
    setBusy(true);
    try { await seat.joinLoyalty(phone); } catch (e) { toast({ title: "Couldn't add your number", description: errorCopy(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <div className={`rounded-[20px] border border-menu-line bg-menu-card p-4 ${className}`}>
      <div className="flex items-center gap-3">
        <span className="h-9 w-9 rounded-full bg-menu-tint text-menu-accent-2 dark:text-menu-accent flex items-center justify-center flex-shrink-0"><Gift className="h-[18px] w-[18px]" strokeWidth={1.75} /></span>
        <div className="min-w-0">
          <p className="font-medium">{loyalty.phone_linked ? <span className="tabular-nums">{points} pts</span> : "Earn points"}</p>
          <p className="text-sm text-menu-muted truncate">{loyalty.reward} at {loyalty.goal} pts</p>
        </div>
      </div>
      {loyalty.phone_linked ? (
        <>
          <div className="mt-3 h-1.5 rounded-full bg-menu-line overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={loyalty.goal} aria-valuenow={points} aria-label="Points">
            <div className="h-full rounded-full bg-menu-accent transition-[width] duration-700" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-menu-muted">
            {points >= loyalty.goal ? `You can claim your ${loyalty.reward.toLowerCase()}. Ask at the counter.` :
              earning ? `This bill adds about ${earning} pts once it's paid.` : `1 pt for every ₹${loyalty.rupees_per_point}, added when the bill is paid.`}
          </p>
        </>
      ) : (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); join(); }}>
          <label htmlFor="loyalty-phone" className="sr-only">Mobile number</label>
          <input id="loyalty-phone" inputMode="tel" autoComplete="tel-national" value={phone} onChange={(e) => setPhone(e.target.value.slice(0, 14))}
            placeholder="Mobile number" className={`${inputClass} h-10 text-[14px]`} />
          <button type="submit" disabled={busy || phone.replace(/\D/g, "").length < 10}
            className="h-10 px-4 rounded-xl bg-menu-ink text-menu-bg text-sm font-medium disabled:opacity-40 flex-shrink-0">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
          </button>
        </form>
      )}
    </div>
  );
}

function WifiCard({ wifi, className = "" }: { wifi: NonNullable<TableState["wifi"]>; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(wifi.password).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {});
  return (
    <div className={`rounded-[20px] border border-menu-line bg-menu-card p-4 ${className}`}>
      <div className="flex items-center gap-3">
        <span className="h-9 w-9 rounded-full bg-menu-tint text-menu-accent-2 dark:text-menu-accent flex items-center justify-center flex-shrink-0"><Wifi className="h-[18px] w-[18px]" strokeWidth={1.75} /></span>
        <div className="min-w-0">
          <p className="font-medium truncate">{wifi.ssid}</p>
          <p className="text-sm text-menu-muted truncate">Password <span className="font-medium text-menu-ink select-all">{wifi.password || "none"}</span></p>
        </div>
      </div>
      {wifi.password && (
        <button onClick={copy} className="mt-3 h-10 w-full rounded-xl border border-menu-line text-sm font-medium flex items-center justify-center gap-2 hover:border-menu-accent/40 transition-colors">
          {copied ? <><Check className="h-4 w-4 text-emerald-600" /> Copied</> : <><Copy className="h-4 w-4" /> Copy password</>}
        </button>
      )}
    </div>
  );
}

// ---------- Spin & Win ----------

const SPIN_MS = 4200;

function SpinDialog({ open, onOpenChange, seat, state }: { open: boolean; onOpenChange: (o: boolean) => void; seat: TableSeat; state: TableState }) {
  const { toast } = useToast();
  const prizes = state.spin_prizes;
  const seg = 360 / prizes.length;
  const landAt = (i: number) => 360 - (i + 0.5) * seg;
  const [angle, setAngle] = useState(() => (state.spin?.index != null ? landAt(state.spin.index) : 0));
  const [spinning, setSpinning] = useState(false);
  const [shown, setShown] = useState<SpinPrize | null>(state.spin);

  const spin = async () => {
    if (spinning || state.spin) return;
    setSpinning(true);
    try {
      const prize = await seat.spin();
      const turns = prefersReducedMotion() ? 0 : 6;
      setAngle(turns * 360 + landAt(prize.index ?? 0));
      setTimeout(() => { setShown(prize); setSpinning(false); }, prefersReducedMotion() ? 0 : SPIN_MS);
    } catch (e) {
      setSpinning(false);
      toast({ title: "Couldn't spin", description: errorCopy(e), variant: "destructive" });
    }
  };

  const applied = shown && state.discount?.code === "SPIN";
  const claim = !shown ? null
    : shown.kind === "none" ? "Not this time. Thanks for playing."
    : shown.kind === "item" ? "Show this screen to a member of staff to claim it."
    : applied ? "Taken off your bill already."
    : `Your bill already has ${state.discount?.label || "a discount"}. Only one discount per bill, so show this to staff.`;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!spinning) onOpenChange(o); }}>
      <DialogContent aria-describedby="spin-sub" className={`${SHEET} max-w-sm [&>button]:hidden`}>
        <div className="px-6 pt-6 pb-6 text-center">
          <div className="flex items-start justify-between text-left">
            <div>
              <DialogTitle className="font-display text-[28px] font-normal leading-tight">Spin & win</DialogTitle>
              <p id="spin-sub" className="mt-1 text-sm text-menu-muted">Something to do while the kitchen cooks. One spin per table.</p>
            </div>
            <CloseButton onClick={() => !spinning && onOpenChange(false)} />
          </div>

          <div className="relative mx-auto mt-6 w-[min(72vw,280px)] aspect-square">
            {/* pointer */}
            <svg viewBox="0 0 24 20" className="absolute left-1/2 -top-1 z-10 w-6 -translate-x-1/2 text-menu-accent drop-shadow-[0_4px_6px_rgba(138,58,30,0.35)]" aria-hidden="true">
              <path d="M12 20 L2 2 Q12 -1 22 2 Z" fill="currentColor" />
            </svg>
            <Wheel prizes={prizes} angle={angle} />
          </div>

          <div className="mt-6 min-h-[72px]" aria-live="polite">
            {shown ? (
              <>
                <p className="font-display text-[24px] leading-tight">{shown.kind === "none" ? shown.label : `You won ${shown.label.toLowerCase().startsWith("free") ? "a " : ""}${shown.label}`}</p>
                <p className="mt-1.5 text-sm text-menu-muted">{claim}</p>
              </>
            ) : (
              <PrimaryButton onClick={spin} disabled={spinning}>{spinning ? "Spinning" : "Spin the wheel"}</PrimaryButton>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Wheel({ prizes, angle }: { prizes: SpinPrize[]; angle: number }) {
  const n = prizes.length;
  const seg = 360 / n;
  const R = 100;
  const pt = (deg: number, r = R) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [R + r * Math.cos(a), R + r * Math.sin(a)];
  };
  return (
    <svg
      viewBox="0 0 200 200"
      className="w-full h-full"
      style={{ transform: `rotate(${angle}deg)`, transition: `transform ${prefersReducedMotion() ? 0 : SPIN_MS}ms cubic-bezier(0.15, 0.72, 0.1, 1)` }}
      role="img"
      aria-label={`Prize wheel: ${prizes.map(p => p.label).join(", ")}`}
    >
      {prizes.map((p, i) => {
        const [x1, y1] = pt(i * seg);
        const [x2, y2] = pt((i + 1) * seg);
        const mid = (i + 0.5) * seg;
        const [tx, ty] = pt(mid, 62);
        const fill = i % 2 === 0 ? "rgb(var(--menu-card))" : "rgb(var(--menu-tint))";
        const label = p.label.length > 13 ? `${p.label.slice(0, 12)}…` : p.label;
        return (
          <g key={i}>
            <path d={`M${R} ${R} L${x1} ${y1} A${R} ${R} 0 ${seg > 180 ? 1 : 0} 1 ${x2} ${y2} Z`} fill={fill} stroke="rgb(var(--menu-line))" strokeWidth="0.75" />
            <text x={tx} y={ty} transform={`rotate(${mid} ${tx} ${ty})`} textAnchor="middle" dominantBaseline="middle"
              fontSize={n > 6 ? 8.5 : 10} fontWeight={600} fill="rgb(var(--menu-ink))" style={{ fontFamily: "inherit" }}>
              {label}
            </text>
          </g>
        );
      })}
      <circle cx={R} cy={R} r={R - 0.75} fill="none" stroke="rgb(var(--menu-accent))" strokeWidth="1.5" />
      <circle cx={R} cy={R} r="15" fill="rgb(var(--menu-bg))" stroke="rgb(var(--menu-line))" />
      <circle cx={R} cy={R} r="5" fill="rgb(var(--menu-accent))" />
    </svg>
  );
}

const MiniWheel = ({ n }: { n: number }) => (
  <svg viewBox="0 0 40 40" className="h-11 w-11 flex-shrink-0" aria-hidden="true">
    {Array.from({ length: n }, (_, i) => {
      const a1 = ((i * 360) / n - 90) * (Math.PI / 180);
      const a2 = (((i + 1) * 360) / n - 90) * (Math.PI / 180);
      return <path key={i} d={`M20 20 L${20 + 19 * Math.cos(a1)} ${20 + 19 * Math.sin(a1)} A19 19 0 0 1 ${20 + 19 * Math.cos(a2)} ${20 + 19 * Math.sin(a2)} Z`}
        fill={i % 2 ? "rgb(var(--menu-tint))" : "rgb(var(--menu-bg))"} stroke="rgb(var(--menu-line))" strokeWidth="0.6" />;
    })}
    <circle cx="20" cy="20" r="19" fill="none" stroke="rgb(var(--menu-accent))" strokeWidth="1.2" />
    <circle cx="20" cy="20" r="3" fill="rgb(var(--menu-accent))" />
  </svg>
);

// The table PIN step (QR scan -> PIN -> menu). The PIN is on the table stand; staff open the table when guests sit.
// Guests can still read the menu without it ("Just look at the menu"); ordering asks for the PIN again.
import { useEffect, useRef, useState } from "react";
import { motion, useAnimationControls } from "framer-motion";
import { Leaf, Loader2, Lock } from "lucide-react";
import { joinErrorCopy, type JoinResult } from "@/lib/tableService";
import { EASE, PrimaryButton, inputClass } from "@/components/guest/ui";

interface Props {
  restaurantName: string;
  logoUrl?: string | null;
  locationLabel: string;
  tableFromQR: string | null;
  demoPin?: string;
  onJoin: (table: string, pin: string) => Promise<JoinResult>;
  onBrowse: () => void;
}

export default function TableGate({ restaurantName, logoUrl, locationLabel, tableFromQR, demoPin, onJoin, onBrowse }: Props) {
  const [table, setTable] = useState(tableFromQR || "");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const shake = useAnimationControls();
  const pinRef = useRef<HTMLInputElement>(null);
  const tableOk = /^[A-Za-z0-9]{1,10}$/.test(table.trim());

  useEffect(() => { if (tableFromQR) pinRef.current?.focus(); }, [tableFromQR]);

  const submit = async (p = pin) => {
    if (busy || p.length !== 4 || !tableOk) return;
    setBusy(true);
    setError(null);
    try {
      const r = await onJoin(table.trim(), p);
      if (r.ok === false) {
        setError(joinErrorCopy(r, table.trim(), locationLabel));
        setLocked(r.error === "locked");
        setPin("");
        shake.start({ x: [0, -10, 9, -6, 4, 0], transition: { duration: 0.42, ease: "easeOut" } });
        pinRef.current?.focus();
      }
    } catch {
      setError(navigator.onLine ? "Couldn't check the PIN. Please try again." : "You're offline. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const onPin = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 4);
    setPin(digits);
    setError(null);
    if (digits.length === 4) submit(digits);
  };

  return (
    <div className="min-h-[100dvh] bg-menu-bg text-menu-ink flex flex-col">
      <motion.main
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
        className="flex-1 w-full max-w-sm mx-auto px-6 pt-[14vh] pb-10 flex flex-col"
      >
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="h-11 w-11 rounded-full object-cover ring-1 ring-menu-line" />
          ) : (
            <span className="h-11 w-11 rounded-full bg-menu-tint text-menu-accent flex items-center justify-center"><Leaf className="h-5 w-5" strokeWidth={1.5} /></span>
          )}
          <p className="font-display text-xl leading-tight truncate">{restaurantName}</p>
        </div>

        <h1 className="mt-10 font-display text-[34px] leading-[1.1] tracking-tight [text-wrap:balance]">
          {tableFromQR ? <>Welcome to {locationLabel.toLowerCase()} {tableFromQR}</> : <>Which {locationLabel.toLowerCase()} are you at?</>}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-menu-muted">
          Enter the 4-digit PIN on your {locationLabel.toLowerCase()} stand to order. Staff can tell you if it's missing.
        </p>

        <form className="mt-8 space-y-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {!tableFromQR && (
            <div>
              <label htmlFor="gate-table" className="block text-sm font-medium mb-2">{locationLabel} number</label>
              <input
                id="gate-table"
                inputMode="text"
                autoComplete="off"
                value={table}
                onChange={(e) => { setTable(e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 10)); setError(null); }}
                placeholder="e.g. 7"
                className={`${inputClass} h-12 text-lg font-medium`}
              />
            </div>
          )}

          <div>
            <label htmlFor="gate-pin" className="block text-sm font-medium mb-2">PIN</label>
            {/* One real input (numeric keypad, paste, autofill) under four drawn slots */}
            <motion.div animate={shake} className="relative" onClick={() => pinRef.current?.focus()}>
              <input
                ref={pinRef}
                id="gate-pin"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={4}
                value={pin}
                disabled={locked || busy}
                onChange={(e) => onPin(e.target.value)}
                aria-invalid={!!error}
                aria-describedby="gate-msg"
                className="peer absolute inset-0 w-full h-full opacity-0 cursor-text"
              />
              <div className="grid grid-cols-4 gap-3" aria-hidden="true">
                {[0, 1, 2, 3].map(i => {
                  const filled = i < pin.length;
                  const current = i === pin.length && !locked;
                  return (
                    <div
                      key={i}
                      className={`h-[68px] rounded-2xl border bg-menu-card flex items-center justify-center font-display text-[30px] tabular-nums transition-colors ${
                        error ? "border-red-500/60" : current ? "border-menu-accent peer-focus:ring-0" : "border-menu-line"}`}
                    >
                      {filled ? pin[i] : current ? <span className="h-7 w-px bg-menu-accent animate-pulse" /> : ""}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </div>

          <p id="gate-msg" role="alert" aria-live="assertive" className={`min-h-[40px] text-sm leading-snug flex items-start gap-2 ${error ? "text-red-600 dark:text-red-400" : "text-menu-muted"}`}>
            {locked && <Lock className="h-4 w-4 mt-0.5 flex-shrink-0" />}
            {error || (demoPin ? <>Demo table: the PIN is <span className="font-semibold text-menu-ink tabular-nums">{demoPin}</span></> : null)}
          </p>

          <PrimaryButton type="submit" disabled={busy || locked || pin.length !== 4 || !tableOk}>
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Checking</> : "Open the menu"}
          </PrimaryButton>
        </form>

        <button onClick={onBrowse} className="mt-4 h-11 text-sm font-medium text-menu-muted hover:text-menu-ink transition-colors underline-offset-4 hover:underline">
          Just look at the menu
        </button>
      </motion.main>
    </div>
  );
}

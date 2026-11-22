// One tap waiter call: pick a reason, see who answered and roughly when they'll arrive.
// One call per table every 30 seconds (the database enforces it too).
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Droplets, Receipt, ConciergeBell, LifeBuoy, SprayCan, Loader2, Check } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { errorCopy, joinErrorCopy, type CallReason, type JoinResult } from "@/lib/tableService";
import type { TableSeat } from "@/hooks/useTableSeat";
import { EASE, SHEET, SheetHeader, inputClass } from "@/components/guest/ui";

const REASONS: { type: CallReason; label: string; Icon: typeof Bell }[] = [
  { type: "water", label: "Water", Icon: Droplets },
  { type: "bill", label: "The bill", Icon: Receipt },
  { type: "waiter", label: "A waiter", Icon: ConciergeBell },
  { type: "help", label: "Help", Icon: LifeBuoy },
  { type: "clean", label: "Clean the table", Icon: SprayCan },
];
const LABEL = Object.fromEntries(REASONS.map(r => [r.type, r.label])) as Record<CallReason, string>;
const ETA_SECONDS = 30;
const COOLDOWN = 30;

const secondsSince = (iso: string | null | undefined, now: number) => (iso ? (now - new Date(iso).getTime()) / 1000 : Infinity);

export default function WaiterCall({ seat, tableNumber, locationLabel, triggerClassName, onOpenBill }: {
  seat: TableSeat; tableNumber: string; locationLabel: string; triggerClassName: string; onOpenBill: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<CallReason | null>(null);
  const [typedTable, setTypedTable] = useState("");
  const [now, setNow] = useState(Date.now());
  const table = tableNumber || seat.seat?.table || typedTable.trim();
  const last = seat.state?.calls?.[0];
  const sinceCall = secondsSince(last?.created_at, now);
  const cooldown = Math.max(0, Math.ceil(COOLDOWN - sinceCall));
  const live = last && (last.status !== "completed" || sinceCall < 120);

  // Tick while something is moving (ETA bar, cooldown)
  useEffect(() => {
    if (!open && !(last && last.status !== "completed")) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [open, last?.status]);

  const call = async (reason: CallReason) => {
    if (!table) return;
    setBusy(reason);
    try {
      await seat.callStaff(table, reason);
      setNow(Date.now());
      toast({ title: `${LABEL[reason]} · ${locationLabel} ${table}`, description: "Staff have been told. You'll see here when someone's on the way." });
    } catch (e) {
      const join = e as JoinResult;
      toast({ title: "Couldn't call staff", description: join && join.ok === false ? joinErrorCopy(join, table, locationLabel) : errorCopy(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const waiting = last && last.status !== "completed" && sinceCall < 3600;
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Call staff" className={triggerClassName}>
        <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
        {waiting && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-menu-bg" />}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined} className={`${SHEET} [&>button]:hidden`}>
          <SheetHeader title="Call staff" onClose={() => setOpen(false)} sub={table ? `${locationLabel} ${table}` : undefined} />

          <div className="px-6 pb-6 pt-2 space-y-5">
            <AnimatePresence mode="wait" initial={false}>
              {live && last && (
                <motion.div
                  key={`${last.id}-${last.status}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="rounded-[20px] border border-menu-line bg-menu-card p-4"
                  aria-live="polite"
                >
                  <CallStatus call={last} now={now} />
                </motion.div>
              )}
            </AnimatePresence>

            {!table && (
              <div>
                <label htmlFor="call-table" className="block text-sm font-medium mb-2">Your {locationLabel.toLowerCase()} number</label>
                <input id="call-table" value={typedTable} onChange={(e) => setTypedTable(e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 10))}
                  placeholder="e.g. 7" className={inputClass} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              {REASONS.map(({ type, label, Icon }, i) => (
                <button
                  key={type}
                  onClick={() => call(type)}
                  disabled={!table || !!busy || cooldown > 0}
                  className={`${i === REASONS.length - 1 ? "col-span-2" : ""} h-[68px] rounded-2xl border border-menu-line bg-menu-card px-4 flex items-center gap-3 text-left text-[15px] font-medium hover:border-menu-accent/50 active:scale-[0.99] disabled:opacity-45 disabled:active:scale-100 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-menu-accent`}
                >
                  <span className="h-9 w-9 rounded-full bg-menu-tint text-menu-accent-2 dark:text-menu-accent flex items-center justify-center flex-shrink-0">
                    {busy === type ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />}
                  </span>
                  {label}
                </button>
              ))}
            </div>

            <p className="text-sm text-menu-muted min-h-5" aria-live="polite">
              {cooldown > 0 ? `You can call again in ${cooldown}s.` : "One tap. No need to wave."}
            </p>

            {seat.state && seat.state.orders.length > 0 && (
              <button onClick={() => { setOpen(false); onOpenBill(); }} className="w-full text-left text-sm text-menu-ink/80 hover:text-menu-ink">
                Want to pay from your phone? <span className="font-medium text-menu-accent-2 dark:text-menu-accent underline underline-offset-4">Open the bill</span>
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CallStatus({ call, now }: { call: NonNullable<TableSeat["state"]>["calls"][number]; now: number }) {
  const reason = LABEL[call.call_type] || "Staff";
  if (call.status === "pending") {
    const late = secondsSince(call.created_at, now) > 180;
    return (
      <div className="flex items-start gap-3">
        <span className="relative mt-1.5 flex h-2.5 w-2.5 flex-shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-60 animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
        </span>
        <div>
          <p className="font-medium">Calling staff · {reason}</p>
          <p className="mt-0.5 text-sm text-menu-muted">{late ? "Taking longer than usual. The manager has been alerted too." : "Waiting for someone to answer."}</p>
        </div>
      </div>
    );
  }
  if (call.status === "acknowledged") {
    const t = secondsSince(call.acknowledged_at, now);
    const pct = Math.min(100, (t / ETA_SECONDS) * 100);
    const left = Math.max(0, Math.ceil(ETA_SECONDS - t));
    return (
      <div>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 h-6 w-6 rounded-full bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
          <div>
            <p className="font-medium">{call.acknowledged_by ? `${call.acknowledged_by} is on the way` : "Someone is on the way"}</p>
            <p className="mt-0.5 text-sm text-menu-muted">{left > 0 ? `Arriving in about ${left} sec · ${reason}` : `Any moment now · ${reason}`}</p>
          </div>
        </div>
        <div className="mt-3.5 h-1 rounded-full bg-menu-line overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Arrival">
          <div className="h-full rounded-full bg-emerald-600 dark:bg-emerald-400 transition-[width] duration-500 ease-linear" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }
  return (
    <p className="text-sm text-menu-ink/80">
      <span className="font-medium text-menu-ink">Done.</span> {call.acknowledged_by ? `${call.acknowledged_by} took care of it.` : "Staff took care of it."} Need anything else?
    </p>
  );
}

// The table's live bill on a guest's phone: what was ordered, the totals, who has paid, and paying your share
// (whole bill, split equally, your items or an amount) with a tip, by UPI app, card or cash. Becomes the receipt
// once everything is paid.
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Banknote, Check, CreditCard, Loader2, RotateCcw, Share2, Smartphone, Star, Ticket } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { clampAmount, equalShare, itemsShare, tipFor, unclaimed } from "@/lib/bill";
import { errorCopy, type PayMode, type SeatOrder, type SeatPayment, type SplitKind } from "@/lib/tableService";
import type { TableSeat } from "@/hooks/useTableSeat";
import { DrawnCheck, EASE, PrimaryButton, SHEET, SecondaryButton, Segmented, SheetHeader, Stepper, inputClass, inr, money } from "@/components/guest/ui";
import { LoyaltyCard } from "@/components/guest/WaitPanel";

const TIPS = [0, 5, 10, 15] as const;
const NAME_KEY = "qm_payer_name";
const ORDER_STEP: Record<string, string> = {
  pending: "Sent", accepted: "Confirmed", preparing: "Preparing", ready: "Ready", completed: "Served", rejected: "Not accepted", cancelled: "Cancelled",
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  seat: TableSeat;
  restaurantName: string;
  upiId: string | null;
  locationLabel: string;
  reviewed: boolean;
  onReview: () => void;
  onOrderAgain: (o: SeatOrder) => void;
  onChangeOrder: (o: SeatOrder) => void;
}

export default function BillSheet(p: Props) {
  const st = p.seat.state;
  const closed = !!st && (st.status === "closed" || (st.bill.total > 0 && st.bill.due === 0));
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent aria-describedby={undefined} className={`${SHEET} max-h-[90dvh] flex flex-col [&>button]:hidden`}>
        {!st ? (
          <>
            <SheetHeader title="Bill" onClose={() => p.onOpenChange(false)} />
            <p className="px-6 pb-8 pt-2 text-sm text-menu-muted">Your table's bill shows up here after the first order.</p>
          </>
        ) : closed ? <Receipt {...p} /> : <OpenBill {...p} />}
      </DialogContent>
    </Dialog>
  );
}

function OpenBill({ seat, onOpenChange, upiId, restaurantName, locationLabel, onOrderAgain, onChangeOrder }: Props) {
  const st = seat.state!;
  const b = st.bill;
  const { toast } = useToast();
  const left = unclaimed(b);
  const equalSoFar = st.payments.filter(x => x.split === "equal" && x.status !== "rejected").length;
  const [split, setSplit] = useState<SplitKind>(equalSoFar ? "equal" : "full");
  const [people, setPeople] = useState(() => Math.max(2, equalSoFar + 1));
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [custom, setCustom] = useState("");
  const [tip, setTip] = useState<number | "custom">(0);
  const [tipCustom, setTipCustom] = useState("");
  const [payer, setPayer] = useState(() => { try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; } });
  const [upiStep, setUpiStep] = useState(false);
  const [busy, setBusy] = useState<PayMode | "coupon" | null>(null);
  const [code, setCode] = useState("");
  const [codeOpen, setCodeOpen] = useState(false);

  const billed = st.orders.filter(o => !["rejected", "cancelled"].includes(o.status));
  const lines = useMemo(() => billed.flatMap(o => (o.items?.items || []).map((l, i) => ({ key: `${o.id}:${i}`, ...l, quantity: l.quantity || 1 }))), [billed]);
  const amount = split === "full" ? left
    : split === "equal" ? equalShare(b, people, equalSoFar)
    : split === "items" ? itemsShare(b, lines.filter(l => picks[l.key]).map(l => ({ price: l.price, quantity: picks[l.key] })))
    : clampAmount(custom, b);
  const tipAmount = tip === "custom" ? Math.min(Math.max(0, Math.round(Number(tipCustom.replace(/\D/g, "")) || 0)), amount) : tipFor(amount, tip);
  const total = amount + tipAmount;

  useEffect(() => { setUpiStep(false); }, [split, people, custom, tip, tipCustom, picks]);

  const pay = async (mode: PayMode) => {
    if (amount <= 0) return;
    setBusy(mode);
    try {
      try { localStorage.setItem(NAME_KEY, payer.trim()); } catch { /* private mode */ }
      await seat.pay({ amount, tip: tipAmount, mode, payer: payer.trim(), split });
      setUpiStep(false);
      toast({
        title: mode === "upi" ? "Payment sent for checking" : mode === "cash" ? "Staff are coming for the cash" : "A card machine is on its way",
        description: mode === "upi" ? `The cashier will confirm ${inr(total)} in a moment.` : `${inr(total)} · ${locationLabel} ${st.table}`,
      });
    } catch (e) {
      toast({ title: "Couldn't record the payment", description: errorCopy(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const applyCode = async () => {
    setBusy("coupon");
    try { await seat.applyCoupon(code); setCodeOpen(false); setCode(""); }
    catch (e) { toast({ title: "Code not applied", description: errorCopy(e), variant: "destructive" }); }
    finally { setBusy(null); }
  };

  const upiHref = upiId ? `upi://pay?pa=${upiId}&pn=${encodeURIComponent(restaurantName)}&am=${total.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`${locationLabel} ${st.table}`)}` : "";
  const status = b.paid > 0 ? "Part paid" : b.pending > 0 ? "Checking payment" : "Open";

  return (
    <>
      <SheetHeader
        title="Bill"
        onClose={() => onOpenChange(false)}
        action={<span className={`h-6 px-2.5 rounded-full text-[11px] font-semibold flex items-center ${b.pending > 0 ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-menu-ink/[0.06] text-menu-ink/70"}`}>{status}</span>}
        sub={<>{locationLabel} {st.table}{st.bill_table !== st.table && <> · one bill with {locationLabel.toLowerCase()} {st.bill_table}</>}</>}
      />

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {/* What was ordered */}
        <div className="px-6 divide-y divide-menu-line">
          {st.orders.map(o => <OrderRows key={o.id} order={o} onOrderAgain={onOrderAgain} onChange={onChangeOrder} />)}
        </div>

        {/* Totals */}
        <div className="mx-6 mt-2 pt-4 border-t border-menu-line space-y-1.5 text-[14px]">
          <Row label="Subtotal" value={money(b.subtotal)} />
          {b.discount > 0 && <Row label={st.discount?.label ? `Discount · ${st.discount.label}` : "Discount"} value={`−${money(b.discount)}`} tone="good" />}
          {b.service > 0 && <Row label={`Service charge ${trim(b.service_pct)}%`} value={money(b.service)} />}
          {b.gst > 0 && <Row label={`GST ${trim(b.gst_rate)}%`} value={money(b.gst)} />}
          <div className="flex items-baseline justify-between pt-2">
            <span className="text-sm font-medium">Total</span>
            <span className="font-display text-[30px] leading-none tabular-nums">{inr(b.total)}</span>
          </div>
          {b.paid > 0 && <Row label="Paid" value={`−${money(b.paid)}`} tone="good" />}
          {b.paid > 0 && <Row label="Left to pay" value={money(b.due)} strong />}
        </div>

        {!st.discount && b.paid === 0 && b.pending === 0 && (
          <div className="px-6 mt-3">
            {codeOpen ? (
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); applyCode(); }}>
                <label htmlFor="bill-code" className="sr-only">Discount code</label>
                <input id="bill-code" autoFocus value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16))}
                  placeholder="Code, e.g. FLAT10" className={`${inputClass} h-10 uppercase tracking-wide`} />
                <button type="submit" disabled={code.length < 3 || busy === "coupon"} className="h-10 px-4 rounded-xl bg-menu-ink text-menu-bg text-sm font-medium disabled:opacity-40 flex-shrink-0">
                  {busy === "coupon" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
                </button>
              </form>
            ) : (
              <button onClick={() => setCodeOpen(true)} className="h-9 text-sm font-medium text-menu-accent-2 dark:text-menu-accent flex items-center gap-1.5">
                <Ticket className="h-4 w-4" strokeWidth={1.75} /> Have a discount code?
              </button>
            )}
          </div>
        )}

        {st.payments.length > 0 && <WhoPaid payments={st.payments} />}

        {st.loyalty && (
          <div className="px-6 mt-5">
            <LoyaltyCard seat={seat} loyalty={st.loyalty} earning={Math.floor(b.total / Math.max(st.loyalty.rupees_per_point, 1))} />
          </div>
        )}

        {/* Paying */}
        {left > 0 ? (
          <div className="px-6 mt-6 pb-2">
            <h3 className="font-display text-[22px] leading-tight">Pay</h3>
            <Segmented<SplitKind>
              className="mt-3 -mx-6 px-6"
              label="How to split"
              value={split}
              onChange={setSplit}
              options={[
                { value: "full", label: b.paid + b.pending > 0 ? "What's left" : "Whole bill" },
                { value: "equal", label: "Split equally" },
                { value: "items", label: "My items" },
                { value: "custom", label: "Amount" },
              ]}
            />

            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={split} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2, ease: EASE }} className="mt-4">
                {split === "equal" && (
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">People at the table</p>
                      <p className="text-xs text-menu-muted mt-0.5">{inr(b.total)} ÷ {people}{equalSoFar > 0 && ` · ${equalSoFar} paid`}</p>
                    </div>
                    <Stepper value={people} min={Math.max(2, equalSoFar + 1)} max={30} onChange={setPeople} label="people" />
                  </div>
                )}
                {split === "items" && (
                  <div className="rounded-2xl border border-menu-line bg-menu-card divide-y divide-menu-line">
                    {lines.map(l => (
                      <div key={l.key} className="px-4 min-h-[56px] py-2 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] truncate">{l.name}</p>
                          <p className="text-xs text-menu-muted tabular-nums">{money(l.price)}{l.quantity > 1 && ` × ${l.quantity}`}</p>
                        </div>
                        {l.quantity > 1 ? (
                          <Stepper value={picks[l.key] || 0} min={0} max={l.quantity} onChange={(n) => setPicks(s => ({ ...s, [l.key]: n }))} label={l.name} />
                        ) : (
                          <button
                            role="checkbox"
                            aria-checked={!!picks[l.key]}
                            aria-label={`I had ${l.name}`}
                            onClick={() => setPicks(s => ({ ...s, [l.key]: s[l.key] ? 0 : 1 }))}
                            className={`h-8 w-8 rounded-full border flex items-center justify-center transition-colors ${picks[l.key] ? "bg-menu-ink border-menu-ink text-menu-bg" : "border-menu-line text-transparent"}`}
                          >
                            <Check className="h-4 w-4" strokeWidth={2.5} />
                          </button>
                        )}
                      </div>
                    ))}
                    <p className="px-4 py-2.5 text-xs text-menu-muted">Tax{b.discount > 0 ? ", discount" : ""}{b.service > 0 ? " and service" : ""} are shared in proportion.</p>
                  </div>
                )}
                {split === "custom" && (
                  <div>
                    <label htmlFor="pay-amount" className="block text-sm font-medium mb-2">Amount you're paying</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-menu-muted">₹</span>
                      <input id="pay-amount" inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^0-9.]/g, "").slice(0, 9))}
                        placeholder={String(Math.floor(left))} className={`${inputClass} pl-8 h-12 text-lg tabular-nums`} />
                    </div>
                    <p className="mt-1.5 text-xs text-menu-muted">Up to {money(left)}. The rest stays on the bill for the others.</p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            <div className="mt-5">
              <p className="text-sm font-medium mb-2">Tip for the team</p>
              <Segmented<number | "custom">
                className="-mx-6 px-6"
                label="Tip"
                value={tip}
                onChange={setTip}
                options={[...TIPS.map(t => ({ value: t as number | "custom", label: t === 0 ? "No tip" : `${t}%` })), { value: "custom", label: "Other" }]}
              />
              {tip === "custom" && (
                <div className="relative mt-2">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-menu-muted">₹</span>
                  <input aria-label="Tip amount" inputMode="numeric" value={tipCustom} onChange={(e) => setTipCustom(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="0" className={`${inputClass} pl-8`} />
                </div>
              )}
            </div>

            <div className="mt-5">
              <label htmlFor="payer-name" className="block text-sm font-medium mb-2">Your name <span className="font-normal text-menu-muted">(so the table sees who paid)</span></label>
              <input id="payer-name" value={payer} onChange={(e) => setPayer(e.target.value.slice(0, 40))} placeholder="Optional" autoComplete="given-name" className={inputClass} />
            </div>
          </div>
        ) : (
          <p className="px-6 mt-6 text-sm text-menu-muted" aria-live="polite">
            Everything left is being checked by the cashier ({money(b.pending)}). This updates on its own.
          </p>
        )}
      </div>

      {left > 0 && (
        <div className="shrink-0 px-6 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] border-t border-menu-line bg-menu-card/95 backdrop-blur-md space-y-2.5">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-menu-muted">{tipAmount > 0 ? `${money(amount)} + ${inr(tipAmount)} tip` : "You pay"}</span>
            <span className="font-display text-[26px] font-semibold tabular-nums">{money(total)}</span>
          </div>
          {upiStep ? (
            <div className="space-y-2" aria-live="polite">
              <p className="text-sm">Did {money(total)} go through in your UPI app?</p>
              <PrimaryButton onClick={() => pay("upi")} disabled={!!busy}>{busy === "upi" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Yes, I've paid</PrimaryButton>
              <div className="grid grid-cols-2 gap-2">
                <SecondaryButton onClick={() => setUpiStep(false)}>Not yet</SecondaryButton>
                <a href={upiHref} className="h-11 rounded-2xl border border-menu-line bg-menu-card/60 text-[14px] font-medium flex items-center justify-center gap-2 hover:border-menu-accent/40">Open UPI again</a>
              </div>
            </div>
          ) : (
            <>
              {upiId ? (
                <a
                  href={amount > 0 ? upiHref : undefined}
                  onClick={(e) => { if (amount <= 0) { e.preventDefault(); return; } setTimeout(() => setUpiStep(true), 400); }}
                  aria-disabled={amount <= 0}
                  className={`w-full h-12 rounded-2xl bg-gradient-to-r from-menu-accent to-menu-accent-2 dark:to-menu-accent text-[#FBF4EA] dark:text-menu-hero text-[15px] font-semibold flex items-center justify-center gap-2 shadow-[0_14px_30px_-14px_rgba(138,58,30,0.7)] active:scale-[0.99] transition-[transform,opacity] ${amount <= 0 ? "opacity-40 pointer-events-none shadow-none" : ""}`}
                >
                  <Smartphone className="h-4 w-4" strokeWidth={2} /> Pay {money(total)} with UPI
                </a>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <SecondaryButton onClick={() => pay("card")} disabled={amount <= 0 || !!busy}>
                  {busy === "card" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" strokeWidth={1.75} />} Card
                </SecondaryButton>
                <SecondaryButton onClick={() => pay("cash")} disabled={amount <= 0 || !!busy}>
                  {busy === "cash" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" strokeWidth={1.75} />} Cash
                </SecondaryButton>
              </div>
              {upiId && <p className="text-center text-xs text-menu-muted">GPay, PhonePe, Paytm or any UPI app · to <span className="text-menu-ink">{upiId}</span></p>}
            </>
          )}
        </div>
      )}
    </>
  );
}

function Receipt({ seat, onOpenChange, restaurantName, locationLabel, reviewed, onReview }: Props) {
  const st = seat.state!;
  const b = st.bill;
  const { toast } = useToast();
  const paid = st.payments.filter(x => x.status === "confirmed");
  const guests = new Set(paid.map(x => x.payer.trim().toLowerCase() || x.id)).size;
  const lines = st.orders.filter(o => !["rejected", "cancelled"].includes(o.status)).flatMap(o => o.items?.items || []);
  const when = new Date(st.closed_at || Date.now()).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  const share = async () => {
    const text = [
      `${restaurantName} · ${locationLabel} ${st.table}`, when, "",
      ...lines.map(l => `${l.quantity || 1} × ${l.name}  ${money(l.price * (l.quantity || 1))}`), "",
      `Subtotal ${money(b.subtotal)}`,
      ...(b.discount > 0 ? [`Discount −${money(b.discount)}`] : []),
      ...(b.service > 0 ? [`Service ${money(b.service)}`] : []),
      ...(b.gst > 0 ? [`GST ${money(b.gst)}`] : []),
      `Total ${inr(b.total)} · paid`, ...(b.tips > 0 ? [`Tips ${inr(b.tips)}`] : []),
    ].join("\n");
    try {
      if (navigator.share) await navigator.share({ title: `Receipt · ${restaurantName}`, text });
      else { await navigator.clipboard.writeText(text); toast({ title: "Receipt copied", description: "Paste it anywhere to keep it." }); }
    } catch { /* share sheet dismissed */ }
  };

  return (
    <>
      <SheetHeader title="Receipt" onClose={() => onOpenChange(false)} />
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 pb-6">
        <div className="text-center pt-2">
          <DrawnCheck className="w-14 h-14 mx-auto text-emerald-600 dark:text-emerald-400" />
          <p className="mt-4 text-sm text-menu-muted">{locationLabel} {st.table} · {when}</p>
          <p className="mt-1 font-display text-[40px] leading-none tabular-nums">{inr(b.paid)}</p>
          <p className="mt-2 text-[15px]">Paid{guests > 1 ? ` · ${guests} guests` : ""}. Thank you{st.served_by ? `, from ${st.served_by} and the team` : ""}.</p>
        </div>

        <div className="mt-6 rounded-[20px] border border-menu-line bg-menu-card px-4 py-3 text-[14px]">
          {lines.map((l, i) => (
            <div key={i} className="flex justify-between gap-4 py-1">
              <span className="min-w-0 truncate">{l.quantity && l.quantity > 1 ? `${l.quantity} × ` : ""}{l.name}</span>
              <span className="tabular-nums text-menu-ink/80">{money(l.price * (l.quantity || 1))}</span>
            </div>
          ))}
          <div className="mt-2 pt-2 border-t border-dashed border-menu-line space-y-1 text-menu-ink/80">
            {b.discount > 0 && <Row label="Discount" value={`−${money(b.discount)}`} tone="good" />}
            {b.service > 0 && <Row label="Service charge" value={money(b.service)} />}
            {b.gst > 0 && <Row label={`GST ${trim(b.gst_rate)}%`} value={money(b.gst)} />}
            <Row label="Total" value={inr(b.total)} strong />
            {b.tips > 0 && <Row label="Tips" value={inr(b.tips)} />}
          </div>
        </div>

        {paid.length > 0 && <WhoPaid payments={st.payments} flush />}

        {st.loyalty && <div className="mt-5"><LoyaltyCard seat={seat} loyalty={st.loyalty} /></div>}

        <div className="mt-6 space-y-2.5">
          {!reviewed && <PrimaryButton onClick={onReview}><Star className="h-4 w-4" strokeWidth={2} /> Rate your meal</PrimaryButton>}
          <SecondaryButton onClick={share}><Share2 className="h-4 w-4" strokeWidth={1.75} /> Save or share receipt</SecondaryButton>
        </div>
      </div>
    </>
  );
}

function OrderRows({ order, onOrderAgain, onChange }: { order: SeatOrder; onOrderAgain: (o: SeatOrder) => void; onChange: (o: SeatOrder) => void }) {
  const voided = order.status === "rejected" || order.status === "cancelled";
  const items = order.items?.items || [];
  return (
    <div className="py-3.5">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-xs text-menu-muted tabular-nums">#{order.order_number.replace(/^ORD0*/, "")} · {ORDER_STEP[order.status] || order.status}</span>
        <span className="flex items-center gap-3">
          {order.status === "pending" && (
            <button onClick={() => onChange(order)} className="text-xs font-medium text-menu-accent-2 dark:text-menu-accent hover:underline underline-offset-4">Change</button>
          )}
          {!voided && (
            <button onClick={() => onOrderAgain(order)} className="text-xs font-medium text-menu-ink/70 hover:text-menu-ink flex items-center gap-1">
              <RotateCcw className="h-3 w-3" strokeWidth={2} /> Order again
            </button>
          )}
        </span>
      </div>
      <div className={`space-y-1 ${voided ? "opacity-50 line-through" : ""}`}>
        {items.map((it, i) => (
          <div key={i} className="flex justify-between gap-4 text-[14px]">
            <span className="min-w-0">
              <span className="truncate block">{it.name}{(it.quantity || 1) > 1 && <span className="text-menu-muted"> × {it.quantity}</span>}</span>
              {(it.selectedSize || it.options) && <span className="block text-xs text-menu-muted truncate">{[it.selectedSize, it.options].filter(Boolean).join(" · ")}</span>}
            </span>
            <span className="tabular-nums text-menu-ink/80">{money(it.price * (it.quantity || 1))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WhoPaid({ payments, flush = false }: { payments: SeatPayment[]; flush?: boolean }) {
  const STATE: Record<SeatPayment["status"], { text: (m: PayMode) => string; cls: string }> = {
    confirmed: { text: () => "Paid", cls: "text-emerald-700 dark:text-emerald-400" },
    pending: { text: (m) => (m === "upi" ? "Cashier checking" : m === "cash" ? "Staff collecting" : "Card machine coming"), cls: "text-amber-700 dark:text-amber-400" },
    rejected: { text: () => "Not received", cls: "text-red-600 dark:text-red-400" },
  };
  const MODE: Record<PayMode, string> = { upi: "UPI", card: "Card", cash: "Cash" };
  return (
    <div className={flush ? "mt-5" : "px-6 mt-5"}>
      <h3 className="text-sm font-medium">Who's paid</h3>
      <ul className="mt-2 rounded-2xl border border-menu-line bg-menu-card divide-y divide-menu-line">
        {payments.map(x => (
          <li key={x.id} className="px-4 h-[52px] flex items-center justify-between gap-3 text-[14px]">
            <span className="min-w-0 truncate">{x.payer || "Guest"} <span className="text-menu-muted">· {MODE[x.mode]}</span></span>
            <span className="flex items-center gap-2 flex-shrink-0">
              <span className="tabular-nums">{money(x.amount + (x.tip || 0))}</span>
              <span className={`text-xs font-semibold flex items-center gap-1 ${STATE[x.status].cls}`}>
                {x.status === "confirmed" && <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
                {STATE[x.status].text(x.mode)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const Row = ({ label, value, tone, strong }: { label: string; value: string; tone?: "good"; strong?: boolean }) => (
  <div className={`flex justify-between gap-4 ${strong ? "font-semibold text-menu-ink" : ""}`}>
    <span className={strong ? "" : "text-menu-ink/75"}>{label}</span>
    <span className={`tabular-nums ${tone === "good" ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{value}</span>
  </div>
);

const trim = (n: number) => String(Number(n));

import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import gsap from "gsap";
import { ArrowLeft, BellRing, Leaf, Maximize, Minimize, Printer, StickyNote, Volume2, VolumeX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessType } from "@/hooks/useBusinessType";
import { printKot } from "@/lib/printKot";
import { STATUS, asStatus, fmtTime, minutesSince, shortOrderNo, withStatus, type OrderPayload, type OrderStatus } from "@/lib/orderFlow";

interface Order {
  id: string;
  order_number: string;
  table_number: string;
  items: OrderPayload | null;
  status: string;
  created_at: string;
  updated_at: string;
}

type Tab = "all" | "new" | "preparing" | "ready";
const TABS: { key: Tab; label: string; statuses: OrderStatus[] }[] = [
  { key: "all", label: "All", statuses: ["pending", "accepted", "preparing", "ready"] },
  { key: "new", label: "New", statuses: ["pending"] },
  { key: "preparing", label: "Preparing", statuses: ["accepted", "preparing"] },
  { key: "ready", label: "Ready", statuses: ["ready"] },
];
// Board order: what needs a decision first
const PRIORITY: Record<string, number> = { pending: 0, ready: 1, accepted: 2, preparing: 3 };

// Short two-tone kitchen bell (WebAudio, no asset needed)
function ring(ctx: AudioContext) {
  const t = ctx.currentTime;
  [[1318, 0], [988, 0.18], [1318, 0.5], [988, 0.68]].forEach(([freq, at]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0, t + at);
    gain.gain.linearRampToValueAtTime(0.35, t + at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + at + 0.45);
    osc.start(t + at);
    osc.stop(t + at + 0.5);
  });
}

const KitchenDisplay = () => {
  const navigate = useNavigate();
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [restaurantName, setRestaurantName] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [tab, setTab] = useState<Tab>("all");
  const [soundOn, setSoundOn] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const audioRef = useRef<AudioContext | null>(null);
  const soundOnRef = useRef(false);
  const { locationLabel } = useBusinessType(restaurantId);

  // Resolve the signed-in restaurant
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }
      const { data } = await supabase.from("restaurants").select("id, name").eq("user_id", session.user.id).single();
      if (data) { setRestaurantId(data.id); setRestaurantName(data.name); }
      setLoading(false);
    })();
  }, [navigate]);

  // Today's orders + realtime updates
  useEffect(() => {
    if (!restaurantId) return;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    supabase.from("orders").select("*")
      .eq("restaurant_id", restaurantId)
      .gte("created_at", startOfDay.toISOString())
      .order("created_at", { ascending: true })
      .then(({ data }: { data: Order[] | null }) => setOrders(data || []));

    const channel = supabase.channel(`kds-${restaurantId}-${Date.now()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` }, (p: { new: Order }) => {
        setOrders(prev => prev.some(o => o.id === p.new.id) ? prev : [...prev, p.new]);
        setFreshIds(prev => new Set(prev).add(p.new.id));
        setTimeout(() => setFreshIds(prev => { const s = new Set(prev); s.delete(p.new.id); return s; }), 20000);
        if (soundOnRef.current && audioRef.current) ring(audioRef.current);
        navigator.vibrate?.([200, 100, 200]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` }, (p: { new: Order }) => {
        setOrders(prev => prev.map(o => o.id === p.new.id ? { ...o, ...p.new } : o));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [restaurantId]);

  // Tick timers
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Browsers only allow audio after a tap, so sound is switched on by the user
  const enableSound = () => {
    audioRef.current ??= new AudioContext();
    audioRef.current.resume();
    ring(audioRef.current);
    soundOnRef.current = true;
    setSoundOn(true);
  };
  const toggleSound = () => {
    if (soundOn) { soundOnRef.current = false; setSoundOn(false); } else enableSound();
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  };

  const setStatus = useCallback(async (order: Order, status: OrderStatus) => {
    const update = withStatus(order, status);
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, ...update, updated_at: new Date().toISOString() } : o));
    setFreshIds(prev => { const s = new Set(prev); s.delete(order.id); return s; });
    await supabase.from("orders").update(update).eq("id", order.id);
  }, []);

  const board = useMemo(() => orders.filter(o => (TABS[0].statuses as string[]).includes(o.status)), [orders]);
  const counts = useMemo(() => Object.fromEntries(TABS.map(t => [t.key, board.filter(o => (t.statuses as string[]).includes(o.status)).length])), [board]);
  const visible = useMemo(() => {
    const t = TABS.find(x => x.key === tab)!;
    return board
      .filter(o => (t.statuses as string[]).includes(o.status))
      .sort((a, b) => (PRIORITY[a.status] - PRIORITY[b.status]) || (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
  }, [board, tab]);

  if (loading) {
    return <div className="min-h-screen bg-[#120E0B]" />;
  }

  return (
    <div className="min-h-screen bg-[#120E0B] text-[#F3EBE0] flex flex-col font-sans">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#120E0B]/90 backdrop-blur-xl">
        <div className="flex items-center gap-3 px-4 sm:px-6 h-16">
          <Link to="/dashboard" className="h-9 w-9 -ml-1 rounded-full flex items-center justify-center text-white/60 hover:bg-white/[0.06] transition-colors" aria-label="Back to dashboard">
            <ArrowLeft className="h-[18px] w-[18px]" />
          </Link>
          <span className="h-10 w-10 rounded-full bg-[#C0602F]/20 text-[#E08A5C] flex items-center justify-center flex-shrink-0">
            <Leaf className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-lg leading-tight truncate">{restaurantName}</h1>
            <p className="text-xs text-white/45">Kitchen Display</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden sm:block text-sm tabular-nums text-white/55 mr-1">
              {new Date(now).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
            </span>
            <span className="flex items-center gap-2 h-8 px-3 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-medium">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-70 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              Live
            </span>
            <button onClick={toggleSound} className={`h-9 w-9 rounded-full flex items-center justify-center transition-colors ${soundOn ? "text-emerald-400 bg-emerald-500/10" : "text-white/55 hover:bg-white/[0.06]"}`} aria-label={soundOn ? "Mute bell" : "Turn on bell"}>
              {soundOn ? <Volume2 className="h-[18px] w-[18px]" /> : <VolumeX className="h-[18px] w-[18px]" />}
            </button>
            <button onClick={toggleFullscreen} className="h-9 w-9 rounded-full flex items-center justify-center text-white/55 hover:bg-white/[0.06] transition-colors" aria-label="Toggle fullscreen">
              {isFullscreen ? <Minimize className="h-[18px] w-[18px]" /> : <Maximize className="h-[18px] w-[18px]" />}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <nav className="flex gap-2 px-4 sm:px-6 pb-3 overflow-x-auto [scrollbar-width:none]">
          {TABS.map(t => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`relative h-9 px-4 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${active ? "text-[#1A130E]" : "text-white/65 hover:text-white bg-white/[0.05]"}`}
              >
                {active && <motion.span layoutId="kds-tab" transition={{ type: "spring", stiffness: 420, damping: 36 }} className="absolute inset-0 rounded-full bg-[#F3EBE0]" />}
                <span className="relative">{t.label} <span className="tabular-nums opacity-70">({counts[t.key]})</span></span>
              </button>
            );
          })}
        </nav>
      </header>

      {/* Sound prompt */}
      <AnimatePresence>
        {!soundOn && (
          <motion.button
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            onClick={enableSound}
            className="w-full overflow-hidden bg-[#C0602F]/15 text-[#E9A27B] text-sm font-medium"
          >
            <span className="flex items-center justify-center gap-2 py-2.5">
              <BellRing className="h-4 w-4" />
              Tap to turn on the new-order bell
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Board */}
      <LayoutGroup>
        <main className="flex-1 p-4 sm:p-6">
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 items-start">
            <AnimatePresence mode="popLayout">
              {visible.map(order => (
                <Ticket key={order.id} order={order} now={now} fresh={freshIds.has(order.id)} locationLabel={locationLabel} onStatus={setStatus} />
              ))}
            </AnimatePresence>
          </div>
          {visible.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-24 text-center">
              <p className="font-display text-2xl text-white/70">All clear</p>
              <p className="mt-2 text-sm text-white/40">{tab === "all" || tab === "new" ? "New orders will appear here the moment they're placed." : "Nothing in this lane right now."}</p>
            </motion.div>
          )}
        </main>
      </LayoutGroup>
    </div>
  );
};

const Ticket = forwardRef<HTMLElement, {
  order: Order; now: number; fresh: boolean; locationLabel: string;
  onStatus: (order: Order, status: OrderStatus) => void;
}>(({ order, now, fresh, locationLabel, onStatus }, ref) => {
  const status = asStatus(order.status);
  const mins = minutesSince(order.created_at, now);
  const lines = order.items?.items ?? [];
  const note = order.items?.note;
  const count = lines.reduce((s, l) => s + (l.quantity || 1), 0);
  const thumb = lines.find(l => l.image_url)?.image_url;
  const late = status !== "ready" && mins >= 20;
  const timer = status === "ready" ? "bg-emerald-500/15 text-emerald-400" : mins < 10 ? "bg-white/[0.06] text-white/70" : mins < 20 ? "bg-amber-500/15 text-amber-400" : "bg-red-500/15 text-red-400";
  const inner = useRef<HTMLDivElement>(null);

  // New tickets drop in with GSAP so they read as "just arrived" rather than just appearing
  useLayoutEffect(() => {
    if (!fresh || !inner.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = gsap.fromTo(inner.current, { y: -28, opacity: 0, scale: 0.95 }, { y: 0, opacity: 1, scale: 1, duration: 0.7, ease: "back.out(1.5)" });
    return () => { t.kill(); };
  }, [fresh]);

  return (
    <motion.article
      ref={ref}
      layout
      initial={false}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.25 } }}
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
    >
      <div
        ref={inner}
        className={`relative rounded-[20px] bg-[#1C1612] border p-5 transition-colors ${fresh ? "border-[#C0602F]/70 shadow-[0_0_0_4px_rgba(192,96,47,0.15)]" : late ? "border-red-500/40" : "border-white/[0.07]"}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-[26px] leading-none">#{shortOrderNo(order.order_number)}</p>
            <p className="mt-1.5 text-xs text-white/45 tabular-nums">{fmtTime(order.created_at)} · {count} {count === 1 ? "item" : "items"}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className="h-7 px-3 rounded-full bg-white/[0.07] text-[13px] font-medium flex items-center">{locationLabel} {order.table_number}</span>
            <div className="flex items-center gap-1.5">
              {fresh && <span className="h-6 px-2 rounded-full bg-[#C0602F] text-white text-[11px] font-semibold flex items-center">NEW</span>}
              <span className={`h-6 px-2 rounded-full text-[11px] font-semibold flex items-center ${STATUS[status].badgeClass}`}>{STATUS[status].badge}</span>
              <span className={`h-6 px-2 rounded-full text-[11px] font-semibold tabular-nums flex items-center ${timer}`}>{mins} min</span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex gap-4">
          <ul className="flex-1 min-w-0 space-y-2">
            {lines.map((l, i) => (
              <li key={i} className="text-[15px] leading-snug">
                <span className="font-semibold tabular-nums text-[#E08A5C]">{l.quantity || 1} ×</span> {l.name}
                {l.selectedSize && <span className="text-white/50"> ({l.selectedSize})</span>}
                {l.options && <span className="block pl-7 text-[13px] text-white/50">{l.options}</span>}
              </li>
            ))}
          </ul>
          {thumb && <img src={thumb} alt="" className="hidden sm:block h-[72px] w-[72px] rounded-xl object-cover flex-shrink-0" />}
        </div>

        {note && (
          <p className="mt-4 flex gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5 text-[13px] text-amber-200/90">
            <StickyNote className="h-4 w-4 flex-shrink-0 mt-px text-amber-400" />
            {note}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          {status === "pending" && (
            <>
              <ActionButton tone="green" onClick={() => onStatus(order, "accepted")}>Accept</ActionButton>
              <ActionButton tone="muted" onClick={() => onStatus(order, "rejected")} narrow>Reject</ActionButton>
            </>
          )}
          {status === "accepted" && <ActionButton tone="accent" onClick={() => onStatus(order, "preparing")}>Start preparing</ActionButton>}
          {status === "preparing" && <ActionButton tone="accent" onClick={() => onStatus(order, "ready")}>Mark ready</ActionButton>}
          {status === "ready" && <ActionButton tone="green" onClick={() => onStatus(order, "completed")}>Mark served</ActionButton>}
          <button onClick={() => printKot(order, locationLabel)} className="h-12 w-12 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] flex items-center justify-center transition-colors flex-shrink-0" aria-label="Print KOT">
            <Printer className="h-[18px] w-[18px] text-white/65" />
          </button>
        </div>
      </div>
    </motion.article>
  );
});
Ticket.displayName = "Ticket";

const ActionButton = ({ tone, narrow, onClick, children }: { tone: "green" | "accent" | "muted"; narrow?: boolean; onClick: () => void; children: React.ReactNode }) => {
  const cls = {
    green: "bg-[#3E8E5E] hover:bg-[#46A06A] text-white",
    accent: "bg-gradient-to-b from-[#B85A2E] to-[#8F4222] hover:from-[#C4643A] text-white",
    muted: "bg-white/[0.06] hover:bg-red-500/15 hover:text-red-300 text-white/75",
  }[tone];
  return (
    <motion.button whileTap={{ scale: 0.97 }} onClick={onClick} className={`h-12 rounded-xl text-[15px] font-semibold transition-colors ${narrow ? "w-28" : "flex-1"} ${cls}`}>
      {children}
    </motion.button>
  );
};

export default KitchenDisplay;

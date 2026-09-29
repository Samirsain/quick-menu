// BACKUP of the old local mode (not imported anywhere). Safe to delete once the real Supabase is working.
// LOCAL MODE: fake in-browser Supabase. No real database, no real auth.
// Data lives in localStorage (DB_KEY); realtime works across tabs via BroadcastChannel.
// Reset data: localStorage.clear() and reload. Bump DB_KEY when the seed changes so old demo data is replaced.
// ponytail: `any`-typed mock covering only the query methods this app uses; restore the
// real createClient from git history to go back to Supabase.

const DB_KEY = "localdb_v3";
const photo = (id: string) => `https://images.unsplash.com/photo-${id}?w=480&q=70&auto=format&fit=crop`;
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();

export const DEMO_USER = { id: "00000000-0000-4000-8000-000000000001", email: "demo@local.test" };
export const DEMO_RESTAURANT_ID = "00000000-0000-4000-8000-0000000000aa";
const PREMIUM_PLAN = "00000000-0000-4000-8000-0000000000b2";
const ADVANCED_PLAN = "00000000-0000-4000-8000-0000000000b1";

function seed(): Record<string, any[]> {
  const r = DEMO_RESTAURANT_ID;
  const cat = (name: string, i: number) => ({ id: uuid(), restaurant_id: r, name, display_order: i, created_at: now(), updated_at: now() });
  const cats = [cat("Starters", 0), cat("Main Course", 1), cat("Drinks", 2)];
  const item = (name: string, price: number, c: number, desc = "", is_veg: boolean | null = true, is_bestseller = false, image_url = "") => ({
    id: uuid(), restaurant_id: r, category_id: cats[c].id, name, description: desc, price, image_url,
    is_available: true, has_size_variants: false, size_variants: [], is_veg, is_bestseller, created_at: now(), updated_at: now(),
  });
  const items = [
    item("Paneer Tikka", 220, 0, "Smoky grilled cottage cheese", true, true, photo("1567188040759-fb8a883dc6d8")),
    item("Veg Spring Roll", 160, 0, "Crispy rolls with veggies", true, false, photo("1625220194771-7ebdea0b70b9")),
    item("Butter Chicken", 340, 1, "Creamy tomato gravy", false, true, photo("1603894584373-5ac82b2ae398")),
    item("Dal Makhani", 240, 1, "Slow cooked black lentils", true, false, photo("1596797038530-2c107229654b")),
    item("Masala Chai", 40, 2, "", null, false, photo("1571934811356-5cc061b6821f")),
    item("Cold Coffee", 120, 2, "", null, false, photo("1517701604599-bb29b565090c")),
  ];
  const order = (n: number, table: string, status: string, min: number, picks: number[]) => ({
    id: uuid(), restaurant_id: r, order_number: `ORD00000${n}`, table_number: table, status, session_id: null,
    items: { items: picks.map(i => ({ id: items[i].id, name: items[i].name, price: items[i].price, quantity: 1, image_url: items[i].image_url, selectedSize: null })) },
    created_at: ago(min), updated_at: ago(min),
  });
  const orders = [order(1, "3", "pending", 5, [0, 2]), order(2, "5", "preparing", 20, [3, 4]), order(3, "1", "completed", 90, [1, 5])];
  const plan = (id: string, name: string, slug: string, monthly: number, orders: boolean) => ({
    id, name, slug, description: `${name} plan`, price_monthly: monthly, price_yearly: monthly * 10, is_active: true,
    has_orders_feature: orders, max_menu_items: orders ? null : 50, max_categories: null,
    features: orders ? ["Everything in Advanced", "Online ordering", "Order notifications"] : ["Digital menu", "QR code", "Up to 50 items"],
    created_at: now(), updated_at: now(),
  });
  return {
    subscription_plans: [plan(ADVANCED_PLAN, "Advanced", "advanced", 199, false), plan(PREMIUM_PLAN, "Premium", "premium", 399, true)],
    restaurants: [{
      id: r, user_id: DEMO_USER.id, name: "Demo Restaurant", description: "Local test restaurant", email: DEMO_USER.email,
      phone: "9999999999", logo_url: null, is_active: true, orders_enabled: true, waiter_call_enabled: true,
      business_type: "restaurant", qr_mode: "single", table_config: { count: 10, skip: [], disabled: [] }, qr_code_url: null,
      social_links: { google_review: "https://search.google.com/local/writereview?placeid=DEMO_PLACE_ID" }, upi_id: "demorestaurant@okaxis", subscription_plan_id: PREMIUM_PLAN, created_at: now(), updated_at: now(),
    }],
    user_subscriptions: [{
      id: uuid(), user_id: DEMO_USER.id, restaurant_id: r, plan_id: PREMIUM_PLAN, status: "active", billing_cycle: "monthly",
      current_period_start: now(), current_period_end: new Date(Date.now() + 365 * 864e5).toISOString(), created_at: now(), updated_at: now(),
    }],
    menu_categories: cats,
    menu_items: items,
    orders,
    feedback: [{ id: uuid(), restaurant_id: r, order_id: orders[2].id, rating: 5, comment: "Great food!", created_at: ago(60) }],
    menu_views: [{ id: uuid(), restaurant_id: r, view_count: 42, created_at: now(), updated_at: now() }],
    service_calls: [],
    admin_actions_log: [],
  };
}

function load(): Record<string, any[]> {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* fall through to seed */ }
  const db = seed();
  save(db);
  return db;
}
function save(db: Record<string, any[]>) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

// ---------- realtime ----------
type Listener = { event: string; table: string; filter?: string; cb: (p: any) => void };
const channels: any[] = [];
const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("localdb") : null;

function dispatch(msg: { table: string; eventType: string; new: any; old: any }) {
  for (const ch of channels) {
    for (const l of ch.listeners as Listener[]) {
      if (l.table !== msg.table || (l.event !== "*" && l.event !== msg.eventType)) continue;
      if (l.filter) {
        const [col, rest] = l.filter.split("=");
        const val = rest?.replace(/^eq\./, "");
        const row = msg.new && Object.keys(msg.new).length ? msg.new : msg.old;
        if (String(row?.[col]) !== val) continue;
      }
      l.cb({ ...msg, schema: "public", commit_timestamp: now() });
    }
  }
}
if (bc) bc.onmessage = (e) => dispatch(e.data);
function emit(table: string, eventType: string, newRow: any, oldRow: any) {
  const msg = { table, eventType, new: newRow ?? {}, old: oldRow ?? {} };
  setTimeout(() => dispatch(msg), 0);
  bc?.postMessage(msg);
}

function channel(topic: string) {
  const ch: any = {
    topic: `realtime:${topic}`,
    listeners: [] as Listener[],
    on(_type: string, cfg: any, cb: (p: any) => void) {
      ch.listeners.push({ event: cfg?.event ?? "*", table: cfg?.table, filter: cfg?.filter, cb });
      return ch;
    },
    subscribe(cb?: (status: string) => void) {
      setTimeout(() => cb?.("SUBSCRIBED"), 0);
      return ch;
    },
    unsubscribe() { removeChannel(ch); return Promise.resolve("ok"); },
    send() { return Promise.resolve("ok"); },
  };
  channels.push(ch);
  return ch;
}
function removeChannel(ch: any) {
  const i = channels.indexOf(ch);
  if (i >= 0) channels.splice(i, 1);
  return Promise.resolve("ok");
}

// ---------- query builder ----------
const singular = (t: string) => t.replace(/s$/, "");

function embed(row: any, selectStr: string, db: Record<string, any[]>) {
  // handles `orders ( ... )` and `alias:fk_column ( ... )`
  const out = { ...row };
  for (const m of selectStr.matchAll(/(\w+)(?::(\w+))?\s*\(/g)) {
    const [, name, fk] = m;
    const table = name;
    const fkCol = fk ?? `${singular(name)}_id`;
    out[name] = (db[table] || []).find(r => r.id === row[fkCol]) ?? null;
  }
  return out;
}

function from(table: string) {
  let op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  let payload: any = null;
  let selectStr = "*";
  let countOpt: any = null;
  let returning = false;
  let mode: "many" | "single" | "maybe" = "many";
  const filters: ((r: any) => boolean)[] = [];
  const orders: { col: string; asc: boolean }[] = [];
  let limitN: number | null = null;

  const cmp = (col: string, fn: (v: any) => boolean) => { filters.push(r => fn(r[col])); return b; };

  const b: any = {
    select(cols = "*", opts?: any) {
      if (op === "select") { selectStr = cols; countOpt = opts ?? null; } else returning = true;
      return b;
    },
    insert(v: any) { op = "insert"; payload = v; return b; },
    upsert(v: any) { op = "upsert"; payload = v; return b; },
    update(v: any) { op = "update"; payload = v; return b; },
    delete() { op = "delete"; return b; },
    eq: (c: string, v: any) => cmp(c, x => x === v || String(x) === String(v)),
    neq: (c: string, v: any) => cmp(c, x => x !== v),
    gt: (c: string, v: any) => cmp(c, x => x > v),
    gte: (c: string, v: any) => cmp(c, x => x >= v),
    lt: (c: string, v: any) => cmp(c, x => x < v),
    lte: (c: string, v: any) => cmp(c, x => x <= v),
    in: (c: string, v: any[]) => cmp(c, x => v.includes(x)),
    is: (c: string, v: any) => cmp(c, x => (x ?? null) === v),
    ilike: (c: string, v: string) => cmp(c, x => new RegExp(`^${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i").test(String(x ?? ""))),
    filter(c: string, o: string, v: any) { return b[o] ? b[o](c, v) : b; },
    order(col: string, opts?: { ascending?: boolean }) { orders.push({ col, asc: opts?.ascending !== false }); return b; },
    limit(n: number) { limitN = n; return b; },
    range(a: number, z: number) { limitN = z + 1; filters.push(() => true); void a; return b; },
    single() { mode = "single"; return b; },
    maybeSingle() { mode = "maybe"; return b; },
    abortSignal() { return b; },
    then(res: any, rej: any) { return Promise.resolve().then(run).then(res, rej); },
  };

  function run() {
    const db = load();
    const rows = (db[table] ||= []);
    const match = (r: any) => filters.every(f => f(r));
    let result: any[] = [];

    if (op === "insert" || op === "upsert") {
      for (const v of Array.isArray(payload) ? payload : [payload]) {
        const existing = op === "upsert" && v.id ? rows.find(r => r.id === v.id) : null;
        if (existing) { Object.assign(existing, v, { updated_at: now() }); result.push(existing); emit(table, "UPDATE", existing, null); continue; }
        const row = { id: uuid(), created_at: now(), updated_at: now(), ...v };
        rows.push(row); result.push(row); emit(table, "INSERT", row, null);
      }
      save(db);
    } else if (op === "update") {
      for (const r of rows.filter(match)) {
        const old = { ...r };
        Object.assign(r, payload, { updated_at: now() });
        result.push(r); emit(table, "UPDATE", r, old);
      }
      save(db);
    } else if (op === "delete") {
      result = rows.filter(match);
      db[table] = rows.filter(r => !match(r));
      result.forEach(r => emit(table, "DELETE", null, r));
      save(db);
    } else {
      result = rows.filter(match);
      for (const { col, asc } of [...orders].reverse()) {
        result.sort((a, z) => (a[col] > z[col] ? 1 : a[col] < z[col] ? -1 : 0) * (asc ? 1 : -1));
      }
      if (limitN != null) result = result.slice(0, limitN);
      result = result.map(r => embed(r, selectStr, db));
      if (countOpt?.count) return { data: countOpt.head ? null : result, count: result.length, error: null };
    }

    if (op !== "select" && !returning) return { data: null, error: null };
    if (mode === "single") {
      return result.length === 1
        ? { data: result[0], error: null }
        : { data: null, error: { message: `Expected 1 row, got ${result.length}`, code: "PGRST116" } };
    }
    if (mode === "maybe") return { data: result[0] ?? null, error: null };
    return { data: result, error: null };
  }

  return b;
}

// ---------- rpc ----------
async function rpc(name: string, args: any = {}) {
  const db = load();
  const restaurant = (id: string) => db.restaurants.find(r => r.id === id);
  const ok = (data: any) => ({ data, error: null });
  switch (name) {
    case "get_user_subscription_status": {
      const sub = db.user_subscriptions.find(s => s.user_id === args.p_user_id);
      const plan = db.subscription_plans.find(p => p.id === sub?.plan_id);
      if (!sub || !plan) return ok([]);
      const active = sub.status === "active";
      return ok([{
        has_subscription: true, subscription_status: sub.status, plan_name: plan.name, plan_slug: plan.slug,
        has_orders_feature: !!plan.has_orders_feature, current_period_end: sub.current_period_end, is_active: active,
      }]);
    }
    case "get_restaurant_subscription_status":
      return ok([{ is_subscription_active: true }]);
    case "create_menu_session":
      return ok(uuid());
    case "validate_menu_session":
      return ok([{ is_valid: true, remaining_minutes: 120, error_message: null }]);
    case "update_table_config": {
      await from("restaurants").update({ qr_mode: args.p_qr_mode, table_config: args.p_table_config }).eq("id", args.p_restaurant_id);
      return ok({ success: true });
    }
    case "toggle_restaurant_status":
      await from("restaurants").update({ is_active: args.p_is_active }).eq("id", args.p_restaurant_id);
      return ok(true);
    case "can_use_ai_import":
      return ok({ allowed: true, credits_used: 0, credits_limit: 99 });
    case "verify_admin_password":
    case "update_admin_password":
      return ok(true);
    case "cancel_user_subscription":
      await from("user_subscriptions").update({ status: "cancelled", cancelled_at: now() }).eq("user_id", args.p_user_id);
      return ok({ success: true });
    case "admin_cancel_subscription":
      await from("user_subscriptions").update({ status: "cancelled", cancelled_at: now() }).eq("id", args.p_subscription_id);
      return ok({ success: true });
    case "admin_activate_subscription": {
      const end = new Date(Date.now() + (args.p_months || 1) * 30 * 864e5).toISOString();
      const existing = db.user_subscriptions.find(s => s.user_id === args.p_user_id);
      const patch = { plan_id: args.p_plan_id, billing_cycle: args.p_billing_cycle, status: "active", current_period_end: end, restaurant_id: args.p_restaurant_id };
      if (existing) await from("user_subscriptions").update(patch).eq("id", existing.id);
      else await from("user_subscriptions").insert({ user_id: args.p_user_id, ...patch });
      if (restaurant(args.p_restaurant_id)) await from("restaurants").update({ subscription_plan_id: args.p_plan_id }).eq("id", args.p_restaurant_id);
      return ok({ success: true, period_end: end });
    }
    default:
      console.warn(`[localdb] rpc "${name}" not mocked`);
      return ok(null);
  }
}

// ---------- auth (always logged in as DEMO_USER) ----------
const session = { user: DEMO_USER, access_token: "local", refresh_token: "local", expires_at: 9999999999 };
const auth = {
  getSession: async () => ({ data: { session }, error: null }),
  getUser: async () => ({ data: { user: DEMO_USER }, error: null }),
  refreshSession: async () => ({ data: { session, user: DEMO_USER }, error: null }),
  signInWithPassword: async () => ({ data: { session, user: DEMO_USER }, error: null }),
  signUp: async () => ({ data: { session, user: DEMO_USER }, error: null }),
  signOut: async () => ({ error: null }),
  updateUser: async () => ({ data: { user: DEMO_USER }, error: null }),
  resetPasswordForEmail: async () => ({ data: {}, error: null }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
};

// ---------- edge functions ----------
const functions = {
  invoke: async (name: string, opts?: { body?: any }) => {
    if (name === "send-order-notification") return { data: { success: true, results: [] }, error: null };
    if (name === "cloudinary") return { data: opts?.body?.action === "sign" ? { local: true } : { success: true, results: [] }, error: null };
    return { data: null, error: { message: `Edge function "${name}" is disabled in local mode` } };
  },
};

export const supabase: any = {
  from,
  rpc,
  auth,
  functions,
  channel,
  removeChannel,
  removeAllChannels: () => { channels.length = 0; return Promise.resolve([]); },
  getChannels: () => channels,
};

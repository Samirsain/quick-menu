import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Staff push alerts through OneSignal, sent to every device tagged with the restaurant's id (Dashboard tags it).
// The browser only says WHAT happened ({ type, id }); the row is read here with the service key, so nobody can
// put their own text in a restaurant's notifications. Old clients that send { record } are treated as an order.
//   type: order | call | payment | feedback
// Secrets: ONESIGNAL_REST_API_KEY (from the OneSignal app below), optional ONESIGNAL_APP_ID to override the app.

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID") || "2d283efb-dc80-4520-87ad-23040771c26e";
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLE: Record<string, string> = { order: "orders", call: "service_calls", payment: "payments", feedback: "feedback" };
const CALL: Record<string, string> = { waiter: "Waiter", water: "Water", bill: "Bill", help: "Help", clean: "Clean the table" };
const MODE: Record<string, string> = { upi: "UPI", card: "Card", cash: "Cash" };

// ponytail: per-instance memory; a busy restaurant across many edge instances could see a duplicate now and then
const sent = new Map<string, number>();
const perRestaurant = new Map<string, { count: number; reset: number }>();
function limited(restaurantId: string) {
  const now = Date.now();
  const e = perRestaurant.get(restaurantId);
  if (!e || now > e.reset) { perRestaurant.set(restaurantId, { count: 1, reset: now + 60_000 }); return false; }
  return ++e.count > 30;
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
async function row(table: string, id: string): Promise<Row | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}&select=*`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  return (await res.json())?.[0] ?? null;
}

const clean = (s: unknown, max = 40) => String(s ?? "").replace(/[^\p{L}\p{N} .,'#₹-]/gu, "").slice(0, max);
const rupees = (n: unknown) => `₹${Math.round(Number(n) || 0)}`;

function message(type: string, r: Row, tableHint?: string) {
  const table = clean(r.table_number || tableHint || "", 10);
  const who = clean(r.payer) || "A guest";
  switch (type) {
    case "order": {
      const items: { price: number; quantity?: number }[] = r.items?.items || [];
      const total = items.reduce((s, i) => s + Number(i.price) * (i.quantity || 1), 0);
      const count = items.reduce((s, i) => s + (i.quantity || 1), 0);
      return {
        title: `New order · Table ${table}`,
        body: `#${clean(r.order_number).replace(/^ORD0*/, "")} · ${count} item${count === 1 ? "" : "s"} · ${rupees(total)}${r.items?.note ? ` · "${clean(r.items.note, 60)}"` : ""}`,
      };
    }
    case "call":
      return { title: `Table ${table} · ${CALL[r.call_type] || "Waiter"}`, body: "A guest is waiting. Tap \"On my way\" so they see your name." };
    case "payment":
      return {
        title: `Table ${table} · ${MODE[r.mode] || "Payment"} ${rupees(Number(r.amount) + Number(r.tip || 0))}`,
        body: r.mode === "upi" ? `${who} says they paid by UPI. Check, then confirm in Cashier.`
          : r.mode === "cash" ? `${who} wants to pay cash. Go collect it.`
          : `${who} wants to pay by card. Take the machine over.`,
      };
    case "feedback":
      return {
        title: `${r.rating}-star review${table ? ` · Table ${table}` : ""}`,
        body: r.comment ? `"${clean(r.comment, 100)}" Worth a visit to the table now.` : "Worth a visit to the table now.",
      };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const type: string = body.record ? "order" : String(body.type || "");
    const id: string = String(body.record?.id || body.id || "");
    if (!TABLE[type] || !UUID.test(id)) return json({ success: false, error: "Invalid request" }, 400);

    const key = `${type}:${id}`;
    if (sent.has(key)) return json({ success: true, message: "Already sent" });

    const r = await row(TABLE[type], id);
    if (!r) return json({ success: false, error: "Not found" }, 404);
    // Only fresh events: an old id replayed later sends nothing
    if (Date.now() - new Date(r.created_at).getTime() > 10 * 60_000) return json({ success: true, message: "Too old to notify" });
    if (type === "feedback" && Number(r.rating) > 2) return json({ success: true, message: "Only low ratings notify" });
    if (limited(r.restaurant_id)) return json({ success: false, error: "Rate limit exceeded" }, 429);

    const tableHint = type === "feedback" ? (await row("orders", r.order_id))?.table_number : undefined;
    const msg = message(type, r, tableHint);
    if (!msg) return json({ success: false, error: "Unknown type" }, 400);

    if (!ONESIGNAL_REST_API_KEY) return json({ success: true, message: "Skipped: ONESIGNAL_REST_API_KEY is not set" });

    const res = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Key ${ONESIGNAL_REST_API_KEY}` }, // os_v2 keys use "Key"
      body: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        filters: [{ field: "tag", key: "restaurant_id", relation: "=", value: r.restaurant_id }],
        headings: { en: msg.title },
        contents: { en: msg.body },
        data: { type, id, restaurant_id: r.restaurant_id },
        priority: 10,
        ttl: type === "order" || type === "call" ? 900 : 3600,
      }),
    });
    const result = await res.json();
    if (result.errors) console.error("OneSignal errors:", result.errors);
    sent.set(key, Date.now());
    for (const [k, t] of sent) if (Date.now() - t > 15 * 60_000) sent.delete(k);
    return json({ success: !result.errors, result });
  } catch (error) {
    console.error("Notification error:", error);
    return json({ success: false, error: "Internal error" }, 500);
  }
});

// Kitchen Order Ticket (KOT) printing, sized for 58/80mm thermal printers.
// Uses a hidden iframe + the browser print dialog, so any printer set up on the device works.

interface KotItem {
  name: string;
  quantity?: number;
  selectedSize?: string | null;
  options?: string | null;
}

interface KotOrder {
  order_number: string;
  table_number: string;
  created_at: string;
  items: { items?: KotItem[]; note?: string | null } | null;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function buildKotHtml(order: KotOrder, locationLabel = "Table"): string {
  const items = order.items?.items ?? [];
  const time = new Date(order.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const rows = items
    .map(i => `<tr><td class="q">${i.quantity || 1}×</td><td>${escapeHtml(i.name)}${i.selectedSize ? ` <small>(${escapeHtml(i.selectedSize)})</small>` : ""}${i.options ? `<br><small>&nbsp;&nbsp;${escapeHtml(i.options)}</small>` : ""}</td></tr>`)
    .join("");
  const totalQty = items.reduce((s, i) => s + (i.quantity || 1), 0);
  return `<!doctype html><html><head><meta charset="utf-8"><title>KOT ${escapeHtml(order.order_number)}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  body { font-family: ui-monospace, Menlo, Consolas, monospace; width: 72mm; margin: 0; color: #000; }
  h1 { font-size: 18px; text-align: center; margin: 0 0 4px; letter-spacing: 2px; }
  .big { font-size: 28px; font-weight: 800; text-align: center; margin: 4px 0; }
  .meta { display: flex; justify-content: space-between; font-size: 12px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 15px; }
  td { padding: 3px 0; vertical-align: top; }
  td.q { width: 34px; font-weight: 800; }
  .foot { font-size: 12px; text-align: center; }
  .note { font-size: 14px; font-weight: 700; }
</style></head><body>
  <h1>KOT</h1>
  <div class="big">${escapeHtml(locationLabel)} ${escapeHtml(order.table_number)}</div>
  <div class="meta"><span>#${escapeHtml(order.order_number)}</span><span>${time}</span></div>
  <hr><table>${rows}</table><hr>${order.items?.note ? `<div class="note">NOTE: ${escapeHtml(order.items.note)}</div><hr>` : ""}
  <div class="foot">${totalQty} item${totalQty === 1 ? "" : "s"}</div>
</body></html>`;
}

export function printKot(order: KotOrder, locationLabel?: string) {
  printHtml(buildKotHtml(order, locationLabel));
}

interface BillSlip {
  restaurant: string;
  table: string;
  lines: { name: string; price: number; quantity?: number; selectedSize?: string | null; options?: string | null }[];
  bill: { subtotal: number; discount: number; service: number; gst: number; gst_rate: number; service_pct: number; total: number; paid: number; due: number; tips: number };
  discountLabel?: string | null;
}

const rs = (n: number) => `Rs ${Number(n).toFixed(2)}`;

/** Customer bill for the counter printer: same 80mm slip as the KOT, with tax lines and what's paid */
export function buildBillHtml(b: BillSlip, locationLabel = "Table"): string {
  const rows = b.lines.map(l => `<tr><td>${l.quantity || 1} × ${escapeHtml(l.name)}${l.selectedSize ? ` <small>(${escapeHtml(l.selectedSize)})</small>` : ""}${l.options ? `<br><small>&nbsp;&nbsp;${escapeHtml(l.options)}</small>` : ""}</td><td class="r">${rs(l.price * (l.quantity || 1))}</td></tr>`).join("");
  const line = (label: string, v: string, cls = "") => `<tr class="${cls}"><td>${label}</td><td class="r">${v}</td></tr>`;
  const when = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return `<!doctype html><html><head><meta charset="utf-8"><title>Bill ${escapeHtml(b.table)}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  body { font-family: ui-monospace, Menlo, Consolas, monospace; width: 72mm; margin: 0; color: #000; font-size: 13px; }
  h1 { font-size: 16px; text-align: center; margin: 0 0 2px; }
  .meta { display: flex; justify-content: space-between; font-size: 12px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; vertical-align: top; }
  .r { text-align: right; white-space: nowrap; padding-left: 6px; }
  .total td { font-size: 16px; font-weight: 800; padding-top: 4px; }
  .foot { font-size: 12px; text-align: center; margin-top: 6px; }
</style></head><body>
  <h1>${escapeHtml(b.restaurant)}</h1>
  <div class="meta"><span>${escapeHtml(locationLabel)} ${escapeHtml(b.table)}</span><span>${when}</span></div>
  <hr><table>${rows}</table><hr><table>
  ${line("Subtotal", rs(b.bill.subtotal))}
  ${b.bill.discount > 0 ? line(`Discount${b.discountLabel ? ` (${escapeHtml(b.discountLabel)})` : ""}`, `- ${rs(b.bill.discount)}`) : ""}
  ${b.bill.service > 0 ? line(`Service charge ${Number(b.bill.service_pct)}%`, rs(b.bill.service)) : ""}
  ${b.bill.gst > 0 ? line(`GST ${Number(b.bill.gst_rate)}%`, rs(b.bill.gst)) : ""}
  ${line("TOTAL", rs(b.bill.total), "total")}
  ${b.bill.paid > 0 ? line("Paid", rs(b.bill.paid)) : ""}
  ${b.bill.paid > 0 ? line("Balance", rs(b.bill.due)) : ""}
  </table><hr><div class="foot">Thank you. Please visit again.</div>
</body></html>`;
}

/** Print any slip through a hidden iframe (shared by KOT and bill) */
export function printHtml(html: string) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  iframe.contentWindow!.focus();
  iframe.contentWindow!.print();
  setTimeout(() => iframe.remove(), 1000);
}

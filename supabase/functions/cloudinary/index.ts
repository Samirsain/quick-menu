// Cloudinary Edge Function
// action "sign":   returns a one-off upload signature so the browser can upload straight to Cloudinary
// action "delete": destroys images the signed-in user uploaded
// The API secret only ever lives here (Supabase secret CLOUDINARY_API_SECRET).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CLOUD_NAME = Deno.env.get("CLOUDINARY_CLOUD_NAME")!;
const API_KEY = Deno.env.get("CLOUDINARY_API_KEY")!;
const API_SECRET = Deno.env.get("CLOUDINARY_API_SECRET")!;
const FOLDERS = ["menu-items", "restaurant-logos", "restaurant-covers"];
const ALLOWED_FORMATS = "jpg,jpeg,png,webp,gif";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Cloudinary signature: SHA-1 of the params sorted by key, joined as a=b&c=d, with the secret appended
async function sign(params: Record<string, string | number>): Promise<string> {
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&") + API_SECRET;
  const hash = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(toSign));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// https://res.cloudinary.com/<cloud>/image/upload/[transforms/]v123/menu-items/<uid>/abc.jpg -> menu-items/<uid>/abc
function publicIdFromUrl(url: string): string | null {
  return url.match(/\/image\/upload\/(?:.*?\/)?v\d+\/(.+)\.[a-z0-9]+$/i)?.[1] ?? null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization header" }, 401);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { action, folder, imageUrl, imageUrls } = await req.json();

    if (action === "sign") {
      if (!FOLDERS.includes(folder)) return json({ error: "Invalid folder" }, 400);
      // Each user uploads into their own sub-folder, which is what lets "delete" check ownership
      const params = { allowed_formats: ALLOWED_FORMATS, folder: `${folder}/${user.id}`, timestamp: Math.floor(Date.now() / 1000) };
      return json({ cloudName: CLOUD_NAME, apiKey: API_KEY, ...params, signature: await sign(params) });
    }

    if (action === "delete") {
      const urls: string[] = imageUrls || (imageUrl ? [imageUrl] : []);
      if (urls.length === 0) return json({ error: "No image URL(s) provided" }, 400);

      const results = await Promise.all(urls.map(async (url) => {
        const publicId = publicIdFromUrl(url);
        if (!url.includes(`res.cloudinary.com/${CLOUD_NAME}/`) || !publicId || !FOLDERS.some((f) => publicId.startsWith(`${f}/${user.id}/`))) {
          return { url, success: false, error: "Not your image" };
        }
        const params = { public_id: publicId, timestamp: Math.floor(Date.now() / 1000) };
        const body = new URLSearchParams({ ...params, timestamp: String(params.timestamp), api_key: API_KEY, signature: await sign(params) });
        const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/destroy`, { method: "POST", body });
        const out = await res.json().catch(() => ({}));
        // "not found" means it's already gone, which is what the caller wanted
        return out.result === "ok" || out.result === "not found"
          ? { url, success: true }
          : { url, success: false, error: out.error?.message || `Cloudinary error: ${res.status}` };
      }));

      const success = results.every((r) => r.success);
      return json({ success, results }, success ? 200 : 207);
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error: any) {
    console.error("Cloudinary function error:", error);
    return json({ error: error.message || "Internal server error" }, 500);
  }
});

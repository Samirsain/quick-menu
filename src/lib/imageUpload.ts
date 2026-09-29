/**
 * Image uploads go straight from the browser to Cloudinary.
 * The `cloudinary` edge function signs each upload, so the API secret never reaches the client.
 */

import { supabase } from "@/integrations/supabase/client";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export interface UploadResult {
  success: boolean;
  publicUrl?: string;
  error?: string;
}

export function validateFile(file: File): { valid: boolean; error?: string } {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, error: "Invalid file type. Allowed: JPEG, PNG, WebP, GIF" };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB` };
  }
  return { valid: true };
}

export function isHostedImage(url: string): boolean {
  return url.includes("res.cloudinary.com/");
}

export async function uploadImage(
  file: File,
  folder: "menu-items" | "restaurant-logos" = "menu-items",
  onProgress?: (progress: number) => void
): Promise<UploadResult> {
  const validation = validateFile(file);
  if (!validation.valid) return { success: false, error: validation.error };

  try {
    const { data, error } = await supabase.functions.invoke("cloudinary", { body: { action: "sign", folder } });
    if (error || data?.error) throw new Error(error?.message || data.error || "Failed to get upload signature");

    const form = new FormData();
    form.append("file", file);
    form.append("api_key", data.apiKey);
    form.append("timestamp", String(data.timestamp));
    form.append("folder", data.folder);
    form.append("allowed_formats", data.allowed_formats);
    form.append("signature", data.signature);

    // XHR rather than fetch so we get upload progress
    return await new Promise<UploadResult>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      });
      xhr.addEventListener("load", () => {
        let body: any = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
        if (xhr.status >= 200 && xhr.status < 300 && body.secure_url) resolve({ success: true, publicUrl: body.secure_url });
        else resolve({ success: false, error: body.error?.message || `Upload failed: ${xhr.status}` });
      });
      xhr.addEventListener("error", () => resolve({ success: false, error: "Network error during upload" }));
      xhr.addEventListener("abort", () => resolve({ success: false, error: "Upload cancelled" }));
      xhr.open("POST", `https://api.cloudinary.com/v1_1/${data.cloudName}/image/upload`);
      xhr.send(form);
    });
  } catch (error: any) {
    console.error("Image upload error:", error);
    return { success: false, error: error.message || "Upload failed. Please try again." };
  }
}

export async function deleteImage(imageUrl: string): Promise<{ success: boolean; error?: string }> {
  if (!isHostedImage(imageUrl)) return { success: true }; // data URLs, old R2 links: nothing to clean up
  try {
    const { data, error } = await supabase.functions.invoke("cloudinary", { body: { action: "delete", imageUrl } });
    if (error) return { success: false, error: error.message };
    if (!data?.success) return { success: false, error: data?.results?.[0]?.error || data?.error };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to delete image" };
  }
}

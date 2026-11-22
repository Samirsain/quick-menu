import { useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  ScanSearch, CheckCircle2, AlertCircle,
  Loader2, ChevronDown, ChevronUp, Utensils, X, RefreshCw, Plus, Images
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { compressImage } from "@/lib/imageOptimization";

interface SizeVariant { name: string; price: number; }
interface ParsedItem {
  name: string;
  description: string;
  price: number;
  has_size_variants: boolean;
  size_variants: SizeVariant[];
}
interface ParsedCategory { name: string; items: ParsedItem[]; }
interface UploadedImage { file: File; previewUrl: string; base64?: string; }

interface AIMenuImportProps {
  restaurantId: string;
  onImportComplete: () => void;
}

const AIMenuImport = ({ restaurantId, onImportComplete }: AIMenuImportProps) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"idle" | "processing" | "review" | "importing" | "done">("idle");
  const [dragOver, setDragOver] = useState(false);
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [parsedCategories, setParsedCategories] = useState<ParsedCategory[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [importProgress, setImportProgress] = useState(0);
  const [importedCount, setImportedCount] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [creditsUsed, setCreditsUsed] = useState(0);
  const [creditsTotal] = useState(3);
  const [creditsLoaded, setCreditsLoaded] = useState(false);
  const [importedItems, setImportedItems] = useState<{ name: string }[]>([]);

  // Load current credit usage on mount
  const loadCredits = useCallback(async () => {
    if (creditsLoaded) return;
    try {
      const { data } = await supabase.rpc("can_use_ai_import" as any, { p_restaurant_id: restaurantId });
      if (data) {
        setCreditsUsed(data.credits_used ?? 0);
        setCreditsLoaded(true);
      }
    } catch { /* silent */ }
  }, [restaurantId, creditsLoaded]);

  // Call on first render
  useState(() => { loadCredits(); });

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    const valid: UploadedImage[] = [];
    for (const file of arr) {
      if (!allowed.includes(file.type)) {
        toast({ title: `${file.name}: unsupported type`, description: "Use JPG, PNG, or WebP", variant: "destructive" });
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast({ title: `${file.name}: too large`, description: "Max 10MB per image", variant: "destructive" });
        continue;
      }
      if (images.length + valid.length >= 20) {
        toast({ title: "Max 20 images", description: "Remove some images first", variant: "destructive" });
        break;
      }
      valid.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    if (valid.length > 0) {
      setImages(prev => [...prev, ...valid]);
      setErrorMsg(null);
    }
  }, [images.length, toast]);

  const removeImage = (idx: number) => {
    setImages(prev => {
      URL.revokeObjectURL(prev[idx].previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleAnalyze = async () => {
    if (images.length === 0) return;
    setStep("processing");
    setErrorMsg(null);

    try {
      // Compress all images for optimal quality and smaller payload
      const compressedImages = await Promise.all(images.map(async (img) => {
        try {
          const compressed = await compressImage(img.file, 'menu');
          return compressed;
        } catch {
          return img.file; // fallback to original if compression fails
        }
      }));

      // Convert compressed images to base64
      const imagePayloads = await Promise.all(compressedImages.map(async (file) => {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        return { base64, type: file.type };
      }));

      // Get existing item names for deduplication
      const { data: existingItems } = await supabase
        .from("menu_items")
        .select("name")
        .eq("restaurant_id", restaurantId);
      const existingNames = (existingItems || []).map(i => i.name);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-menu-import`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            restaurant_id: restaurantId,
            images: imagePayloads,
            existing_item_names: existingNames,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 429) {
          setCreditsUsed(data.credits_used ?? creditsTotal);
          throw new Error(data.error || "All AI import credits used this billing period");
        }
        throw new Error(data.error || "Failed to analyze menu");
      }

      if (!data.categories || data.categories.length === 0) {
        throw new Error("No new items found — all items already exist in your menu.");
      }

      setParsedCategories(data.categories);
      setTotalItems(data.total_items);
      setCreditsUsed(creditsTotal - (data.credits_remaining ?? 0));
      setExpandedCategories(new Set(data.categories.map((c: ParsedCategory) => c.name)));
      setStep("review");

    } catch (err: any) {
      setErrorMsg(err.message);
      setStep("idle");
    }
  };

  const handleImport = async () => {
    setStep("importing");
    setImportProgress(0);
    setImportedCount(0);
    setImportedItems([]);

    let imported = 0;
    const allItems = parsedCategories.flatMap((cat, catIdx) =>
      cat.items.map(item => ({
        ...item,
        categoryName: cat.name,
      }))
    );
    const total = allItems.length;

    try {
      // Upsert categories
      const categoryMap: Record<string, string> = {};
      for (let i = 0; i < parsedCategories.length; i++) {
        const cat = parsedCategories[i];
        const { data: existing } = await supabase
          .from("menu_categories")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .ilike("name", cat.name)
          .maybeSingle();

        if (existing) {
          categoryMap[cat.name] = existing.id;
        } else {
          const { data: newCat } = await supabase
            .from("menu_categories")
            .insert({ restaurant_id: restaurantId, name: cat.name, display_order: i + 1 })
            .select("id")
            .single();
          if (newCat) categoryMap[cat.name] = newCat.id;
        }
      }

      // Insert items one by one with animation
      for (const item of allItems) {
        const categoryId = categoryMap[item.categoryName] || null;
        // description and image_url are NOT NULL in the schema; the menu shows the dish's initial when there's no image
        const { error: insertError } = await supabase.from("menu_items").insert({
          restaurant_id: restaurantId,
          name: item.name.trim(),
          description: item.description?.trim() || "",
          image_url: "",
          price: item.has_size_variants ? 0 : (item.price || 0),
          category_id: categoryId,
          is_available: true,
          has_size_variants: item.has_size_variants,
          size_variants: item.has_size_variants ? item.size_variants : [],
        });
        if (insertError) throw insertError;
        imported++;
        setImportedCount(imported);
        setImportProgress(Math.round((imported / total) * 100));
        setImportedItems(prev => [...prev, { name: item.name }]);
        await new Promise(r => setTimeout(r, 120)); // Slightly slower for visible animation
      }

      setStep("done");
      toast({
        title: "Menu imported",
        description: `${imported} items added across ${parsedCategories.length} categories`,
        duration: 6000,
      });
      setTimeout(() => onImportComplete(), 2000);

    } catch (err: any) {
      setErrorMsg(err.message);
      setStep("review");
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    }
  };

  const reset = () => {
    images.forEach(img => URL.revokeObjectURL(img.previewUrl));
    setStep("idle");
    setImages([]);
    setParsedCategories([]);
    setExpandedCategories(new Set());
    setImportProgress(0);
    setImportedCount(0);
    setImportedItems([]);
    setTotalItems(0);
    setErrorMsg(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const creditsRemaining = creditsTotal - creditsUsed;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
          <ScanSearch className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-base flex items-center gap-2 flex-wrap">
            AI Menu Import
            <Badge className="bg-accent text-accent-foreground border-transparent text-xs rounded-full" variant="outline">
              {creditsRemaining}/{creditsTotal} credits left
            </Badge>
          </h3>
          <p className="text-xs text-muted-foreground">Upload up to 20 menu photos. AI reads the items, descriptions and prices.</p>
        </div>
      </div>

      {/* Credits bar */}
      <div className="flex gap-1.5">
        {Array.from({ length: creditsTotal }).map((_, i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i < creditsUsed ? 'bg-muted' : 'bg-primary'}`} />
        ))}
      </div>

      {/* Error */}
      <AnimatePresence>
        {errorMsg && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <div className="flex items-start gap-3 p-4 bg-destructive/10 rounded-2xl border border-destructive/25">
              <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-sm font-medium text-destructive flex-1">{errorMsg}</p>
              <button onClick={() => setErrorMsg(null)} className="text-destructive/70 hover:text-destructive"><X className="h-4 w-4" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {/* IDLE — Upload */}
        {step === "idle" && (
          <motion.div key="idle" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-3">
            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
                dragOver ? "border-primary bg-accent/50" :
                "border-border hover:border-primary/50 hover:bg-accent/40"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && addFiles(e.target.files)}
              />
              <motion.div animate={dragOver ? { scale: 1.05 } : { scale: 1 }} className="flex flex-col items-center gap-2">
                <div className="w-12 h-12 rounded-2xl bg-accent flex items-center justify-center">
                  <Images className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Drop menu photos here</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Up to 20 images • JPG, PNG, WebP • Max 10MB each</p>
                </div>
                <Button variant="outline" size="sm" className="rounded-xl gap-1.5 pointer-events-none mt-1">
                  <Plus className="h-3.5 w-3.5" />Add Images
                </Button>
              </motion.div>
            </div>

            {/* Image thumbnails */}
            {images.length > 0 && (
              <div className="space-y-3">
                {/* Preview grid — larger thumbnails with numbers */}
                <div className="grid grid-cols-3 gap-3">
                  {images.map((img, idx) => (
                    <div key={idx} className="relative group aspect-[4/3] rounded-xl overflow-hidden border-2 border-border shadow-sm">
                      <img src={img.previewUrl} alt={`Menu page ${idx + 1}`} className="w-full h-full object-cover" />
                      {/* Image number badge */}
                      <div className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center">
                        <span className="text-[11px] font-bold text-white">{idx + 1}</span>
                      </div>
                      {/* Remove button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); removeImage(idx); }}
                        className="absolute top-1.5 right-1.5 w-6 h-6 bg-destructive hover:bg-destructive/90 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      {/* File size */}
                      <div className="absolute bottom-1.5 right-1.5">
                        <span className="text-[11px] font-medium bg-black/50 text-white px-1.5 py-0.5 rounded-full">
                          {(img.file.size / 1024 / 1024).toFixed(1)}MB
                        </span>
                      </div>
                    </div>
                  ))}
                  {/* Add more button */}
                  {images.length < 20 && (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="aspect-[4/3] rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-accent/40 flex flex-col items-center justify-center text-muted-foreground hover:text-primary transition-all gap-1"
                    >
                      <Plus className="h-6 w-6" />
                      <span className="text-[11px] font-medium">Add more</span>
                    </button>
                  )}
                </div>

                {/* Summary */}
                <div className="flex items-center justify-between px-1">
                  <p className="text-xs text-muted-foreground">
                    {images.length} image{images.length !== 1 ? "s" : ""} ready to analyze
                  </p>
                  <button onClick={() => { images.forEach(img => URL.revokeObjectURL(img.previewUrl)); setImages([]); }} className="text-xs text-destructive hover:text-destructive/80 font-medium">
                    Clear all
                  </button>
                </div>

                {/* Analyze button */}
                <Button
                  onClick={handleAnalyze}
                  disabled={creditsRemaining <= 0}
                  className="w-full h-12 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold gap-2 disabled:opacity-50"
                >
                  <ScanSearch className="h-5 w-5" />
                  {creditsRemaining <= 0 ? "No credits remaining" : `Analyze ${images.length} Image${images.length !== 1 ? "s" : ""} with AI`}
                </Button>
                {creditsRemaining <= 0 && (
                  <p className="text-xs text-center text-muted-foreground">Credits reset on your next billing cycle</p>
                )}
              </div>
            )}
          </motion.div>
        )}

        {/* PROCESSING */}
        {step === "processing" && (
          <motion.div key="processing" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
            className="flex flex-col items-center gap-5 py-10"
          >
            <div className="relative">
              <motion.div className="absolute inset-0 rounded-full border-4 border-primary/40"
                animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                style={{ width: 80, height: 80, margin: -8 }}
              />
              <div className="w-16 h-16 rounded-full bg-accent flex items-center justify-center">
                <ScanSearch className="h-8 w-8 text-primary animate-pulse" />
              </div>
            </div>
            <div className="text-center">
              <p className="font-semibold">AI is reading {images.length} image{images.length !== 1 ? "s" : ""}...</p>
              <p className="text-sm text-muted-foreground mt-1">Extracting items, descriptions, prices, and size variants</p>
            </div>
            <div className="flex gap-1.5">
              {[0, 1, 2].map(i => (
                <motion.div key={i} className="w-2 h-2 rounded-full bg-primary"
                  animate={{ y: [0, -8, 0] }}
                  transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </div>
          </motion.div>
        )}

        {/* REVIEW */}
        {step === "review" && parsedCategories.length > 0 && (
          <motion.div key="review" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-accent/50 rounded-2xl border border-primary/20">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                <div>
                  <p className="font-semibold text-sm text-foreground">
                    Found {totalItems} new items in {parsedCategories.length} categories
                  </p>
                  <p className="text-xs text-accent-foreground">Duplicates already removed • Review and import</p>
                </div>
              </div>
              <button onClick={reset} className="text-muted-foreground hover:text-foreground"><RefreshCw className="h-4 w-4" /></button>
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {parsedCategories.map((cat, catIdx) => {
                const isExpanded = expandedCategories.has(cat.name);
                return (
                  <Card key={cat.name} className="overflow-hidden">
                    <button
                      onClick={() => setExpandedCategories(prev => { const n = new Set(prev); n.has(cat.name) ? n.delete(cat.name) : n.add(cat.name); return n; })}
                      className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-accent text-primary flex items-center justify-center font-display text-sm" aria-hidden>{cat.name.charAt(0)}</div>
                        <span className="font-semibold text-sm">{cat.name}</span>
                        <Badge variant="secondary" className="rounded-full text-xs">{cat.items.length}</Badge>
                      </div>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </button>
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
                          <div className="px-3 pb-3 space-y-1.5 border-t">
                            {cat.items.map((item, itemIdx) => (
                              <div key={itemIdx} className="flex items-start gap-3 p-2.5 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors">
                                
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-sm">{item.name}</p>
                                  {item.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>}
                                  {item.has_size_variants && item.size_variants.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {item.size_variants.map((v, vi) => (
                                        <span key={vi} className="text-xs bg-accent text-accent-foreground px-2 py-0.5 rounded-full">
                                          {v.name}: ₹{v.price}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <span className="text-sm font-semibold text-primary flex-shrink-0">
                                  {item.has_size_variants ? "Variants" : item.price > 0 ? `₹${item.price}` : "—"}
                                </span>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Card>
                );
              })}
            </div>

            <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}>
              <Button
                onClick={handleImport}
                className="w-full h-12 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold gap-2"
              >
                <Utensils className="h-5 w-5" />
                Import All {totalItems} Items
              </Button>
            </motion.div>
          </motion.div>
        )}

        {/* IMPORTING — animated item list */}
        {step === "importing" && (
          <motion.div key="importing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            {/* Progress header */}
            <div className="flex items-center gap-3 p-3 bg-accent/50 rounded-2xl border border-primary/20">
              <Loader2 className="h-5 w-5 text-primary animate-spin flex-shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-sm text-foreground">
                  Adding items... {importedCount}/{totalItems}
                </p>
                <Progress value={importProgress} className="h-1.5 rounded-full mt-1.5" />
              </div>
              <span className="text-xs font-mono text-accent-foreground">{importProgress}%</span>
            </div>

            {/* Animated item list — shows items appearing one by one */}
            <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
              {importedItems.map((item, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: -20, scale: 0.95 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="flex items-center gap-2.5 p-2 rounded-xl bg-card border border-border"
                >
                  <span className="text-sm font-medium truncate flex-1 pl-1">{item.name}</span>
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* DONE */}
        {step === "done" && (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-4 py-8">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 20 }}>
              <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              </div>
            </motion.div>
            <div className="text-center">
              <p className="font-bold text-lg">Import Complete!</p>
              <p className="text-sm text-muted-foreground mt-1">{importedCount} items added to your menu</p>
              <p className="text-xs text-muted-foreground mt-1">{creditsRemaining} credit{creditsRemaining !== 1 ? "s" : ""} remaining this billing period</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AIMenuImport;

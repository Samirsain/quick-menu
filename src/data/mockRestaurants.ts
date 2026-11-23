export interface MockRestaurant {
  id: string;
  name: string;
  description: string;
  email: string;
  phone: string;
  logo_url: string;
  cover_url: string;
  is_active: boolean;
  orders_enabled: boolean;
  waiter_call_enabled: boolean;
  business_type: "restaurant" | "hotel";
  qr_mode: "single" | "per_table";
  table_config: { count: number; skip: number[]; disabled: number[] };
  social_links: {
    instagram?: string;
    website?: string;
    google_review?: string;
    facebook?: string;
    twitter?: string;
  };
  upi_id: string;
  subscription_plan_id: string;
  created_at: string;
  updated_at: string;
}

export interface MockCategory {
  id: string;
  restaurant_id: string;
  name: string;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface MockMenuItem {
  id: string;
  restaurant_id: string;
  category_id: string;
  name: string;
  description: string;
  price: number;
  image_url: string;
  is_available: boolean;
  has_size_variants: boolean;
  size_variants: { name: string; price: number }[];
  is_veg: boolean | null; // true = veg, false = non-veg, null = drink/neutral
  is_bestseller: boolean;
  /** v2: minutes the kitchen needs, add-ons a guest can pick, chef's pick badge */
  prep_minutes?: number | null;
  addons?: { name: string; price: number }[];
  is_chef_special?: boolean;
  created_at: string;
  updated_at: string;
}

export const ZEN_CAFE_ID = "zencafe";
export const ZEN_CAFE_UUID = "00000000-0000-4000-8000-0000000000aa";

export const isZenCafe = (id?: string | null): boolean => {
  if (!id) return false;
  const normalized = id.toLowerCase().trim();
  return (
    normalized === "zencafe" ||
    normalized === "zen-cafe" ||
    normalized === "demo" ||
    normalized === ZEN_CAFE_UUID
  );
};

export const ZEN_CAFE_RESTAURANT: MockRestaurant = {
  id: ZEN_CAFE_ID,
  name: "ZenCafe",
  description: "Artisanal specialty coffee, handcrafted sourdough brunch & mindful botanical sips in a tranquil sanctuary.",
  email: "hello@zencafe.in",
  phone: "+91 98765 43210",
  // Minimal warm coffee art icon
  logo_url: "https://images.unsplash.com/photo-1511920170033-f8396924c348?w=320&q=80&auto=format&fit=crop",
  // Elegant modern warm aesthetic cafe interior
  cover_url: "https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=1600&q=85&auto=format&fit=crop",
  is_active: true,
  orders_enabled: true,
  waiter_call_enabled: true,
  business_type: "restaurant",
  qr_mode: "single",
  table_config: { count: 12, skip: [], disabled: [] },
  social_links: {
    instagram: "https://instagram.com/zencafe",
    website: "https://zenviqdigital.in",
    google_review: "https://search.google.com/local/writereview?placeid=ChIJZenCafeDemo",
  },
  upi_id: "zencafe@okaxis",
  subscription_plan_id: "00000000-0000-4000-8000-0000000000b2",
  created_at: "2026-01-01T08:00:00.000Z",
  updated_at: "2026-01-01T08:00:00.000Z",
};

export const ZEN_CAFE_CATEGORIES: MockCategory[] = [
  {
    id: "cat_specialty_coffee",
    restaurant_id: ZEN_CAFE_ID,
    name: "Specialty Coffee & Cold Brews",
    display_order: 0,
    created_at: "2026-01-01T08:00:00.000Z",
    updated_at: "2026-01-01T08:00:00.000Z",
  },
  {
    id: "cat_artisan_teas",
    restaurant_id: ZEN_CAFE_ID,
    name: "Artisanal Teas & Matcha",
    display_order: 1,
    created_at: "2026-01-01T08:00:00.000Z",
    updated_at: "2026-01-01T08:00:00.000Z",
  },
  {
    id: "cat_cold_pressed",
    restaurant_id: ZEN_CAFE_ID,
    name: "Cold Pressed Juices & Bowls",
    display_order: 2,
    created_at: "2026-01-01T08:00:00.000Z",
    updated_at: "2026-01-01T08:00:00.000Z",
  },
  {
    id: "cat_artisan_brunch",
    restaurant_id: ZEN_CAFE_ID,
    name: "All-Day Artisan Brunch",
    display_order: 3,
    created_at: "2026-01-01T08:00:00.000Z",
    updated_at: "2026-01-01T08:00:00.000Z",
  },
  {
    id: "cat_sourdough_sandwiches",
    restaurant_id: ZEN_CAFE_ID,
    name: "Gourmet Sourdough Paninis",
    display_order: 4,
    created_at: "2026-01-01T08:00:00.000Z",
    updated_at: "2026-01-01T08:00:00.000Z",
  },
  {
    id: "cat_bowls_mains",
    restaurant_id: ZEN_CAFE_ID,
    name: "Nourish Bowls & Mains",
    display_order: 5,
    created_at: "2026-01-01T08:00:00.000Z",
    updated_at: "2026-01-01T08:00:00.000Z",
  },
  {
    id: "cat_small_plates",
    restaurant_id: ZEN_CAFE_ID,
    name: "Small Plates & Grazing",
    display_order: 6,
    created_at: "2026-01-01T08:00:00.000Z",
    updated_at: "2026-01-01T08:00:00.000Z",
  },
  {
    id: "cat_patisserie_desserts",
    restaurant_id: ZEN_CAFE_ID,
    name: "Patisserie & Desserts",
    display_order: 7,
    created_at: "2026-01-01T08:00:00.000Z",
    updated_at: "2026-01-01T08:00:00.000Z",
  },
];

export const ZEN_CAFE_MENU_ITEMS: MockMenuItem[] = [
  // ── 1. Specialty Coffee & Cold Brews ──
  {
    id: "item_spanish_latte",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_specialty_coffee",
    name: "Spanish Velvet Latte",
    description: "Single-origin espresso blended with condensed milk, steamed whole milk, and a dusting of Ceylon cinnamon.",
    price: 240,
    image_url: "https://images.unsplash.com/photo-1541167760496-1628856ab772?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: true,
    size_variants: [
      { name: "Regular (240ml)", price: 240 },
      { name: "Grande (350ml)", price: 290 },
    ],
    is_veg: null,
    is_bestseller: true,
    created_at: "2026-01-01T08:00:00.000Z",
    updated_at: "2026-01-01T08:00:00.000Z",
  },
  {
    id: "item_vanilla_cold_brew",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_specialty_coffee",
    name: "Vanilla Bean Slow Cold Brew",
    description: "18-hour steep Ethiopian beans, poured over a crystal ice sphere with subtle notes of Tahitian vanilla.",
    price: 220,
    image_url: "https://images.unsplash.com/photo-1517701604599-bb29b565090c?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: true,
    size_variants: [
      { name: "Classic Black", price: 220 },
      { name: "Oat Milk Cloud", price: 260 },
    ],
    is_veg: null,
    is_bestseller: true,
    created_at: "2026-01-01T08:01:00.000Z",
    updated_at: "2026-01-01T08:01:00.000Z",
  },
  {
    id: "item_chemex_pourover",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_specialty_coffee",
    name: "Artisan Pour-Over (Chemex)",
    description: "Single-estate washed Geisha beans featuring bright floral jasmine notes and a refreshing bergamot finish.",
    price: 260,
    image_url: "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: false,
    size_variants: [],
    is_veg: null,
    is_bestseller: false,
    created_at: "2026-01-01T08:02:00.000Z",
    updated_at: "2026-01-01T08:02:00.000Z",
  },
  {
    id: "item_cortado_zen",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_specialty_coffee",
    name: "Cortado al Zen",
    description: "Double ristretto balanced with equal parts silky textured warm milk in a heavy fluted glass.",
    price: 190,
    image_url: "https://images.unsplash.com/photo-1511920170033-f8396924c348?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: false,
    size_variants: [],
    is_veg: null,
    is_bestseller: false,
    created_at: "2026-01-01T08:03:00.000Z",
    updated_at: "2026-01-01T08:03:00.000Z",
  },

  // ── 2. Artisanal Teas & Matcha ──
  {
    id: "item_ceremonial_matcha",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_artisan_teas",
    name: "Uji Ceremonial Matcha Latte",
    description: "Stone-ground grade-A ceremonial matcha from Kyoto, whisked with steamed organic oat milk and raw wildflower honey.",
    price: 280,
    image_url: "https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: true,
    size_variants: [
      { name: "Hot Velvety", price: 280 },
      { name: "Iced on Rock", price: 300 },
    ],
    is_veg: null,
    is_bestseller: true,
    created_at: "2026-01-01T08:04:00.000Z",
    updated_at: "2026-01-01T08:04:00.000Z",
  },
  {
    id: "item_hibiscus_peach",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_artisan_teas",
    name: "Wild Hibiscus & Peach Sparkler",
    description: "Cold-infused ruby hibiscus petals, white peach puree, crushed wild mint, and chilled sparkling water.",
    price: 210,
    image_url: "https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: false,
    size_variants: [],
    is_veg: null,
    is_bestseller: true,
    created_at: "2026-01-01T08:05:00.000Z",
    updated_at: "2026-01-01T08:05:00.000Z",
  },
  {
    id: "item_saffron_kahwa",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_artisan_teas",
    name: "Kashmiri Saffron Kahwa",
    description: "Whole green tea leaves gently brewed with crushed green cardamom, cinnamon, Kashmiri saffron threads, and slivered almonds.",
    price: 195,
    image_url: "https://images.unsplash.com/photo-1571934811356-5cc061b6821f?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: false,
    size_variants: [],
    is_veg: null,
    is_bestseller: false,
    created_at: "2026-01-01T08:06:00.000Z",
    updated_at: "2026-01-01T08:06:00.000Z",
  },

  // ── 3. Cold Pressed Juices & Bowls ──
  {
    id: "item_green_zen_juice",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_cold_pressed",
    name: "Green Zen Botanical Elixir",
    description: "Cold-pressed Granny Smith apple, baby spinach, English cucumber, celery, fresh ginger root, and Meyer lemon.",
    price: 220,
    image_url: "https://images.unsplash.com/photo-1613478223719-2ab802602423?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: false,
    size_variants: [],
    is_veg: null,
    is_bestseller: false,
    created_at: "2026-01-01T08:07:00.000Z",
    updated_at: "2026-01-01T08:07:00.000Z",
  },
  {
    id: "item_acai_bowl",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_cold_pressed",
    name: "Acai Berry Chia Glow Bowl",
    description: "Wild Brazilian acai blended thick with frozen banana & coconut milk, topped with toasted granola, chia seeds, and dragonfruit.",
    price: 340,
    image_url: "https://images.unsplash.com/photo-1590301157890-4810ed352733?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: false,
    size_variants: [],
    is_veg: true,
    is_bestseller: true,
    created_at: "2026-01-01T08:08:00.000Z",
    updated_at: "2026-01-01T08:08:00.000Z",
  },

  // ── 4. All-Day Artisan Brunch ──
  {
    id: "item_avocado_tartine",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_artisan_brunch",
    name: "Avocado Tartine on House Sourdough",
    description: "Charred sourdough loaded with smashed Hass avocado, Persian feta, toasted pumpkin seeds, watermelon radish, and cold-pressed EVOO.",
    price: 320,
    image_url: "https://images.unsplash.com/photo-1525351484163-7529414344d8?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: true,
    size_variants: [
      { name: "Classic Smashed Tartine", price: 320 },
      { name: "With Poached Farm Egg", price: 360 },
    ],
    is_veg: true,
    is_bestseller: true,
    created_at: "2026-01-01T08:09:00.000Z",
    updated_at: "2026-01-01T08:09:00.000Z",
  },
  {
    id: "item_truffle_eggs",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_artisan_brunch",
    name: "Truffle Scrambled Brioche",
    description: "Silky slow-folded pasture eggs infused with black truffle butter, chives, and aged parmesan on toasted golden brioche.",
    price: 340,
    image_url: "https://images.unsplash.com/photo-1608039829572-78524f79c4c7?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: true,
    size_variants: [
      { name: "Classic Scramble", price: 340 },
      { name: "With Herb Roasted Chicken", price: 420 },
    ],
    is_veg: false,
    is_bestseller: true,
    created_at: "2026-01-01T08:10:00.000Z",
    updated_at: "2026-01-01T08:10:00.000Z",
  },
  {
    id: "item_french_toast",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_artisan_brunch",
    name: "Caramelized Brioche French Toast",
    description: "Thick golden brioche soaked in vanilla bean custard, brûléed crust, salted caramel drizzle, and fresh forest berries.",
    price: 310,
    image_url: "https://images.unsplash.com/photo-1584776296944-ab6fb57b0bdd?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: false,
    size_variants: [],
    is_veg: true,
    is_bestseller: true,
    created_at: "2026-01-01T08:11:00.000Z",
    updated_at: "2026-01-01T08:11:00.000Z",
  },

  // ── 5. Gourmet Sourdough Paninis ──
  {
    id: "item_pesto_focaccia",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_sourdough_sandwiches",
    name: "Caprese & Pistachio Pesto Focaccia",
    description: "Warm rosemary focaccia, buffalo mozzarella, sun-ripened Roma tomatoes, wild basil & pistachio pesto, and aged Modena balsamic.",
    price: 330,
    image_url: "https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: false,
    size_variants: [],
    is_veg: true,
    is_bestseller: true,
    created_at: "2026-01-01T08:12:00.000Z",
    updated_at: "2026-01-01T08:12:00.000Z",
  },
  {
    id: "item_smoked_chicken_panini",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_sourdough_sandwiches",
    name: "Slow-Roasted Herb Chicken Panini",
    description: "Charred sourdough panini layered with lemon-thyme roasted chicken breast, smoked gouda, wild arugula, and garlic confit aioli.",
    price: 370,
    image_url: "https://images.unsplash.com/photo-1550547660-d9450f859349?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: false,
    size_variants: [],
    is_veg: false,
    is_bestseller: true,
    created_at: "2026-01-01T08:13:00.000Z",
    updated_at: "2026-01-01T08:13:00.000Z",
  },

  // ── 6. Nourish Bowls & Mains ──
  {
    id: "item_zen_buddha_bowl",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_bowls_mains",
    name: "Zen Garden Buddha Bowl",
    description: "Organic tricolor quinoa, roasted butternut squash, steamed edamame, avocado ribbons, purple cabbage, tahini-miso ginger dressing.",
    price: 360,
    image_url: "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: false,
    size_variants: [],
    is_veg: true,
    is_bestseller: true,
    created_at: "2026-01-01T08:14:00.000Z",
    updated_at: "2026-01-01T08:14:00.000Z",
  },
  {
    id: "item_truffle_tagliatelle",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_bowls_mains",
    name: "Wild Porcini & Truffle Tagliatelle",
    description: "Handmade tagliatelle tossed in browned butter, wild forest porcini, white wine emulsion, parmigiano reggiano, and black winter truffle.",
    price: 440,
    image_url: "https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: false,
    size_variants: [],
    is_veg: true,
    is_bestseller: true,
    created_at: "2026-01-01T08:15:00.000Z",
    updated_at: "2026-01-01T08:15:00.000Z",
  },
  {
    id: "item_burrata_rigatoni",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_bowls_mains",
    name: "Burrata Pomodoro Rustico",
    description: "Slow-simmered San Marzano tomato sugo, bronze-die rigatoni pasta, torn creamy Italian burrata, fresh basil, and cold-pressed olive oil.",
    price: 420,
    image_url: "https://images.unsplash.com/photo-1546549032-9571cd6b27df?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: false,
    size_variants: [],
    is_veg: true,
    is_bestseller: false,
    created_at: "2026-01-01T08:16:00.000Z",
    updated_at: "2026-01-01T08:16:00.000Z",
  },

  // ── 7. Small Plates & Grazing ──
  {
    id: "item_truffle_fries",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_small_plates",
    name: "Hand-Cut Parmesan Truffle Fries",
    description: "Crispy twice-cooked skin-on potatoes tossed in white truffle oil, rosemary sea salt, grated aged parmesan, with roasted garlic aioli.",
    price: 240,
    image_url: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: false,
    size_variants: [],
    is_veg: true,
    is_bestseller: true,
    created_at: "2026-01-01T08:17:00.000Z",
    updated_at: "2026-01-01T08:17:00.000Z",
  },
  {
    id: "item_whipped_feta",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_small_plates",
    name: "Whipped Persian Feta & Warm Flatbread",
    description: "Creamy whipped feta infused with lemon zest, Aleppo pepper oil, toasted pine nuts, served with wood-fired herb sourdough flatbread.",
    price: 260,
    image_url: "https://images.unsplash.com/photo-1577906096429-f73c2c312435?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: false,
    size_variants: [],
    is_veg: true,
    is_bestseller: false,
    created_at: "2026-01-01T08:18:00.000Z",
    updated_at: "2026-01-01T08:18:00.000Z",
  },
  {
    id: "item_togarashi_edamame",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_small_plates",
    name: "Charred Togarashi Edamame",
    description: "Wok-seared young green soybeans in pods tossed with Japanese togarashi spice blend, sesame oil, and crunchy Maldon sea salt flakes.",
    price: 210,
    image_url: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: false,
    size_variants: [],
    is_veg: true,
    is_bestseller: false,
    created_at: "2026-01-01T08:19:00.000Z",
    updated_at: "2026-01-01T08:19:00.000Z",
  },

  // ── 8. Patisserie & Decadent Desserts ──
  {
    id: "item_basque_cheesecake",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_patisserie_desserts",
    name: "San Sebastián Basque Burnt Cheesecake",
    description: "Caramelized deep-brown exterior yielding an ultra-creamy, molten vanilla core, finished with fresh wild raspberry coulis.",
    price: 290,
    image_url: "https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: false,
    size_variants: [],
    is_veg: true,
    is_bestseller: true,
    created_at: "2026-01-01T08:20:00.000Z",
    updated_at: "2026-01-01T08:20:00.000Z",
  },
  {
    id: "item_espresso_tiramisu",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_patisserie_desserts",
    name: "Artisan Venetian Tiramisu",
    description: "Savoiardi ladyfingers soaked in Zen espresso & dark cocoa, layered with airy mascarpone sabayon and dusted with single-origin Valrhona cocoa.",
    price: 270,
    image_url: "https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: false,
    size_variants: [],
    is_veg: true,
    is_bestseller: true,
    created_at: "2026-01-01T08:21:00.000Z",
    updated_at: "2026-01-01T08:21:00.000Z",
  },
  {
    id: "item_almond_croissant",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_patisserie_desserts",
    name: "Double-Baked Almond Croissant",
    description: "Twice-baked French butter croissant filled with velvety almond frangipane cream, topped with toasted sliced almonds and powdered sugar.",
    price: 210,
    image_url: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: false,
    size_variants: [],
    is_veg: true,
    is_bestseller: false,
    created_at: "2026-01-01T08:22:00.000Z",
    updated_at: "2026-01-01T08:22:00.000Z",
  },
  {
    id: "item_chocolate_tart",
    restaurant_id: ZEN_CAFE_ID,
    category_id: "cat_patisserie_desserts",
    name: "Belgian 70% Dark Chocolate Truffle Tart",
    description: "Buttery chocolate sable shell filled with silky single-origin dark chocolate ganache, sea salt crystals, and edible gold leaf.",
    price: 280,
    image_url: "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=800&q=80&auto=format&fit=crop",
    is_available: true,
    has_size_variants: false,
    size_variants: [],
    is_veg: true,
    is_bestseller: false,
    created_at: "2026-01-01T08:23:00.000Z",
    updated_at: "2026-01-01T08:23:00.000Z",
  },
];

export const getMockRestaurant = (id?: string | null): MockRestaurant => {
  return { ...ZEN_CAFE_RESTAURANT, id: id || ZEN_CAFE_ID };
};

export const getMockCategories = (restaurantId?: string | null): MockCategory[] => {
  const rid = restaurantId || ZEN_CAFE_ID;
  return ZEN_CAFE_CATEGORIES.map(c => ({ ...c, restaurant_id: rid }));
};

// v2 extras for the demo: every dish gets a prep time, a few get add-ons and a chef's pick badge
const DRINKS = ["cat_specialty_coffee", "cat_artisan_teas", "cat_cold_pressed"];
const DEMO_EXTRAS: Record<string, Partial<MockMenuItem>> = {
  item_spanish_latte: { addons: [{ name: "Extra shot", price: 40 }, { name: "Oat milk", price: 50 }] },
  item_cortado_zen: { addons: [{ name: "Extra shot", price: 40 }] },
  item_avocado_tartine: { addons: [{ name: "Feta crumble", price: 50 }, { name: "Chilli oil", price: 20 }], prep_minutes: 10 },
  item_truffle_eggs: { is_chef_special: true, prep_minutes: 12 },
  item_truffle_tagliatelle: { is_chef_special: true, prep_minutes: 15, addons: [{ name: "Extra parmesan", price: 60 }, { name: "Grilled chicken", price: 120 }] },
  item_zen_buddha_bowl: { addons: [{ name: "Paneer", price: 80 }, { name: "Grilled chicken", price: 120 }] },
  item_truffle_fries: { addons: [{ name: "Cheese sauce", price: 40 }], prep_minutes: 8 },
  item_basque_cheesecake: { is_chef_special: true, prep_minutes: 4 },
};

export const getMockMenuItems = (restaurantId?: string | null): MockMenuItem[] => {
  const rid = restaurantId || ZEN_CAFE_ID;
  return ZEN_CAFE_MENU_ITEMS.map(i => ({
    ...i,
    restaurant_id: rid,
    prep_minutes: DRINKS.includes(i.category_id) ? 5 : 12,
    addons: [],
    is_chef_special: false,
    ...DEMO_EXTRAS[i.id],
  }));
};


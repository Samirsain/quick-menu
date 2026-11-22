-- ==============================================================================
-- QuickMenu: ZenCafe Mock Restaurant Seed Data (Safe Upsert)
-- Handles existing user_id and updates restaurant to ZenCafe with full menu
-- ==============================================================================

DO $$
DECLARE
  v_user_id UUID;
  v_restaurant_id UUID;
  v_cat_coffee UUID := gen_random_uuid();
  v_cat_teas UUID := gen_random_uuid();
  v_cat_juices UUID := gen_random_uuid();
  v_cat_brunch UUID := gen_random_uuid();
  v_cat_paninis UUID := gen_random_uuid();
  v_cat_mains UUID := gen_random_uuid();
  v_cat_starters UUID := gen_random_uuid();
  v_cat_desserts UUID := gen_random_uuid();
BEGIN
  -- 1. Identify user: get the latest user from auth.users
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at DESC LIMIT 1;
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No user found in auth.users. Please sign up or create a user first.';
  END IF;

  -- 2. Check if this user already has a restaurant
  SELECT id INTO v_restaurant_id FROM public.restaurants WHERE user_id = v_user_id LIMIT 1;

  IF v_restaurant_id IS NOT NULL THEN
    -- User already has a restaurant -> Update it to ZenCafe
    UPDATE public.restaurants SET
      name = 'ZenCafe',
      description = 'Artisanal specialty coffee, handcrafted sourdough brunch & mindful botanical sips in a tranquil sanctuary.',
      email = 'hello@zencafe.in',
      phone = '+91 98765 43210',
      logo_url = 'https://images.unsplash.com/photo-1511920170033-f8396924c348?w=320&q=80&auto=format&fit=crop',
      cover_url = 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=1600&q=85&auto=format&fit=crop',
      is_active = true,
      orders_enabled = true,
      waiter_call_enabled = true,
      business_type = 'restaurant',
      qr_mode = 'single',
      table_config = '{"count": 12, "skip": [], "disabled": []}'::jsonb,
      social_links = '{"instagram": "https://instagram.com/zencafe", "website": "https://zenviqdigital.in", "google_review": "https://search.google.com/local/writereview?placeid=ChIJZenCafeDemo"}'::jsonb,
      upi_id = 'zencafe@okaxis'
    WHERE id = v_restaurant_id;
    
    RAISE NOTICE 'Updated existing restaurant (ID: %) to ZenCafe for user %', v_restaurant_id, v_user_id;
  ELSE
    -- No restaurant exists for this user -> Create one
    v_restaurant_id := '00000000-0000-4000-8000-0000000000aa';
    
    -- In case another restaurant row has this static ID, generate random
    IF EXISTS (SELECT 1 FROM public.restaurants WHERE id = v_restaurant_id) THEN
      v_restaurant_id := gen_random_uuid();
    END IF;

    INSERT INTO public.restaurants (
      id, user_id, name, description, email, phone, logo_url, cover_url,
      is_active, orders_enabled, waiter_call_enabled, business_type, qr_mode,
      table_config, social_links, upi_id
    ) VALUES (
      v_restaurant_id,
      v_user_id,
      'ZenCafe',
      'Artisanal specialty coffee, handcrafted sourdough brunch & mindful botanical sips in a tranquil sanctuary.',
      'hello@zencafe.in',
      '+91 98765 43210',
      'https://images.unsplash.com/photo-1511920170033-f8396924c348?w=320&q=80&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=1600&q=85&auto=format&fit=crop',
      true,
      true,
      true,
      'restaurant',
      'single',
      '{"count": 12, "skip": [], "disabled": []}'::jsonb,
      '{"instagram": "https://instagram.com/zencafe", "website": "https://zenviqdigital.in", "google_review": "https://search.google.com/local/writereview?placeid=ChIJZenCafeDemo"}'::jsonb,
      'zencafe@okaxis'
    );
    
    RAISE NOTICE 'Created new ZenCafe restaurant (ID: %) for user %', v_restaurant_id, v_user_id;
  END IF;

  -- 3. Clear existing categories & items for this restaurant
  DELETE FROM public.menu_items WHERE restaurant_id = v_restaurant_id;
  DELETE FROM public.menu_categories WHERE restaurant_id = v_restaurant_id;

  -- 4. Insert Menu Categories
  INSERT INTO public.menu_categories (id, restaurant_id, name, display_order) VALUES
    (v_cat_coffee, v_restaurant_id, 'Specialty Coffee & Cold Brews', 0),
    (v_cat_teas, v_restaurant_id, 'Artisanal Teas & Matcha', 1),
    (v_cat_juices, v_restaurant_id, 'Cold Pressed Juices & Bowls', 2),
    (v_cat_brunch, v_restaurant_id, 'All-Day Artisan Brunch', 3),
    (v_cat_paninis, v_restaurant_id, 'Gourmet Sourdough Paninis', 4),
    (v_cat_mains, v_restaurant_id, 'Nourish Bowls & Mains', 5),
    (v_cat_starters, v_restaurant_id, 'Small Plates & Grazing', 6),
    (v_cat_desserts, v_restaurant_id, 'Patisserie & Desserts', 7);

  -- 5. Insert Menu Items (Food & Drinks with Real Photos)
  -- ── Specialty Coffee & Cold Brews ──
  INSERT INTO public.menu_items (restaurant_id, category_id, name, description, price, image_url, is_available, has_size_variants, size_variants, is_veg, is_bestseller) VALUES
    (v_restaurant_id, v_cat_coffee, 'Spanish Velvet Latte', 'Single-origin espresso blended with condensed milk, steamed whole milk, and a dusting of Ceylon cinnamon.', 240, 'https://images.unsplash.com/photo-1541167760496-1628856ab772?w=800&q=80&auto=format&fit=crop', true, true, '[{"name": "Regular (240ml)", "price": 240}, {"name": "Grande (350ml)", "price": 290}]'::jsonb, null, true),
    (v_restaurant_id, v_cat_coffee, 'Vanilla Bean Slow Cold Brew', '18-hour steep Ethiopian beans, poured over a crystal ice sphere with subtle notes of Tahitian vanilla.', 220, 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?w=800&q=80&auto=format&fit=crop', true, true, '[{"name": "Classic Black", "price": 220}, {"name": "Oat Milk Cloud", "price": 260}]'::jsonb, null, true),
    (v_restaurant_id, v_cat_coffee, 'Artisan Pour-Over (Chemex)', 'Single-estate washed Geisha beans featuring bright floral jasmine notes and a bergamot finish.', 260, 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&q=80&auto=format&fit=crop', true, false, '[]'::jsonb, null, false),
    (v_restaurant_id, v_cat_coffee, 'Cortado al Zen', 'Double ristretto balanced with equal parts velvety textured warm milk in a heavy fluted glass.', 190, 'https://images.unsplash.com/photo-1511920170033-f8396924c348?w=800&q=80&auto=format&fit=crop', true, false, '[]'::jsonb, null, false);

  -- ── Artisanal Teas & Matcha ──
  INSERT INTO public.menu_items (restaurant_id, category_id, name, description, price, image_url, is_available, has_size_variants, size_variants, is_veg, is_bestseller) VALUES
    (v_restaurant_id, v_cat_teas, 'Uji Ceremonial Matcha Latte', 'Stone-ground grade-A ceremonial matcha from Kyoto, whisked with steamed organic oat milk and raw wildflower honey.', 280, 'https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=800&q=80&auto=format&fit=crop', true, true, '[{"name": "Hot Velvety", "price": 280}, {"name": "Iced on Rock", "price": 300}]'::jsonb, null, true),
    (v_restaurant_id, v_cat_teas, 'Wild Hibiscus & Peach Sparkler', 'Cold-infused ruby hibiscus petals, white peach puree, crushed wild mint, and chilled sparkling spring water.', 210, 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=800&q=80&auto=format&fit=crop', true, false, '[]'::jsonb, null, true),
    (v_restaurant_id, v_cat_teas, 'Kashmiri Saffron Kahwa', 'Whole green tea leaves gently brewed with crushed cardamom, cinnamon, Kashmiri saffron threads, and slivered almonds.', 195, 'https://images.unsplash.com/photo-1571934811356-5cc061b6821f?w=800&q=80&auto=format&fit=crop', true, false, '[]'::jsonb, null, false);

  -- ── Cold Pressed Juices & Bowls ──
  INSERT INTO public.menu_items (restaurant_id, category_id, name, description, price, image_url, is_available, has_size_variants, size_variants, is_veg, is_bestseller) VALUES
    (v_restaurant_id, v_cat_juices, 'Green Zen Botanical Elixir', 'Cold-pressed Granny Smith apple, baby spinach, English cucumber, celery, fresh ginger root, and Meyer lemon.', 220, 'https://images.unsplash.com/photo-1613478223719-2ab802602423?w=800&q=80&auto=format&fit=crop', true, false, '[]'::jsonb, null, false),
    (v_restaurant_id, v_cat_juices, 'Acai Berry Chia Glow Bowl', 'Wild Brazilian acai blended thick with frozen banana & coconut milk, topped with toasted granola, chia seeds, and dragonfruit.', 340, 'https://images.unsplash.com/photo-1590301157890-4810ed352733?w=800&q=80&auto=format&fit=crop', true, false, '[]'::jsonb, true, true);

  -- ── All-Day Artisan Brunch ──
  INSERT INTO public.menu_items (restaurant_id, category_id, name, description, price, image_url, is_available, has_size_variants, size_variants, is_veg, is_bestseller) VALUES
    (v_restaurant_id, v_cat_brunch, 'Avocado Tartine on House Sourdough', 'Charred sourdough loaded with smashed Hass avocado, Persian feta, toasted pumpkin seeds, watermelon radish, and cold-pressed EVOO.', 320, 'https://images.unsplash.com/photo-1525351484163-7529414344d8?w=800&q=80&auto=format&fit=crop', true, true, '[{"name": "Classic Smashed Tartine", "price": 320}, {"name": "With Poached Farm Egg", "price": 360}]'::jsonb, true, true),
    (v_restaurant_id, v_cat_brunch, 'Truffle Scrambled Brioche', 'Silky slow-folded pasture eggs infused with black truffle butter, chives, and aged parmesan on toasted golden brioche.', 340, 'https://images.unsplash.com/photo-1608039829572-78524f79c4c7?w=800&q=80&auto=format&fit=crop', true, true, '[{"name": "Classic Scramble", "price": 340}, {"name": "With Herb Roasted Chicken", "price": 420}]'::jsonb, false, true),
    (v_restaurant_id, v_cat_brunch, 'Caramelized Brioche French Toast', 'Thick golden brioche soaked in vanilla bean custard, brûléed crust, salted caramel drizzle, and fresh forest berries.', 310, 'https://images.unsplash.com/photo-1584776296944-ab6fb57b0bdd?w=800&q=80&auto=format&fit=crop', true, false, '[]'::jsonb, true, true);

  -- ── Gourmet Sourdough Paninis ──
  INSERT INTO public.menu_items (restaurant_id, category_id, name, description, price, image_url, is_available, has_size_variants, size_variants, is_veg, is_bestseller) VALUES
    (v_restaurant_id, v_cat_paninis, 'Caprese & Pistachio Pesto Focaccia', 'Warm rosemary focaccia, buffalo mozzarella, sun-ripened Roma tomatoes, wild basil & pistachio pesto, and aged Modena balsamic.', 330, 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=800&q=80&auto=format&fit=crop', true, false, '[]'::jsonb, true, true),
    (v_restaurant_id, v_cat_paninis, 'Slow-Roasted Herb Chicken Panini', 'Charred sourdough panini layered with lemon-thyme roasted chicken breast, smoked gouda, wild arugula, and garlic confit aioli.', 370, 'https://images.unsplash.com/photo-1550547660-d9450f859349?w=800&q=80&auto=format&fit=crop', true, false, '[]'::jsonb, false, true);

  -- ── Nourish Bowls & Mains ──
  INSERT INTO public.menu_items (restaurant_id, category_id, name, description, price, image_url, is_available, has_size_variants, size_variants, is_veg, is_bestseller) VALUES
    (v_restaurant_id, v_cat_mains, 'Zen Garden Buddha Bowl', 'Organic tricolor quinoa, roasted butternut squash, steamed edamame, avocado ribbons, purple cabbage, tahini-miso ginger dressing.', 360, 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=800&q=80&auto=format&fit=crop', true, false, '[]'::jsonb, true, true),
    (v_restaurant_id, v_cat_mains, 'Wild Porcini & Truffle Tagliatelle', 'Handmade tagliatelle tossed in browned butter, wild forest porcini, white wine emulsion, parmigiano reggiano, and black winter truffle.', 440, 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=800&q=80&auto=format&fit=crop', true, false, '[]'::jsonb, true, true),
    (v_restaurant_id, v_cat_mains, 'Burrata Pomodoro Rustico', 'Slow-simmered San Marzano tomato sugo, bronze-die rigatoni pasta, torn creamy Italian burrata, fresh basil, and cold-pressed olive oil.', 420, 'https://images.unsplash.com/photo-1546549032-9571cd6b27df?w=800&q=80&auto=format&fit=crop', true, false, '[]'::jsonb, true, false);

  -- ── Small Plates & Grazing ──
  INSERT INTO public.menu_items (restaurant_id, category_id, name, description, price, image_url, is_available, has_size_variants, size_variants, is_veg, is_bestseller) VALUES
    (v_restaurant_id, v_cat_starters, 'Hand-Cut Parmesan Truffle Fries', 'Crispy twice-cooked skin-on potatoes tossed in white truffle oil, rosemary sea salt, grated aged parmesan, with roasted garlic aioli.', 240, 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=800&q=80&auto=format&fit=crop', true, false, '[]'::jsonb, true, true),
    (v_restaurant_id, v_cat_starters, 'Whipped Persian Feta & Warm Flatbread', 'Creamy whipped feta infused with lemon zest, Aleppo pepper oil, toasted pine nuts, served with wood-fired herb sourdough flatbread.', 260, 'https://images.unsplash.com/photo-1577906096429-f73c2c312435?w=800&q=80&auto=format&fit=crop', true, false, '[]'::jsonb, true, false),
    (v_restaurant_id, v_cat_starters, 'Charred Togarashi Edamame', 'Wok-seared young green soybeans in pods tossed with Japanese togarashi spice blend, sesame oil, and crunchy Maldon sea salt flakes.', 210, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&q=80&auto=format&fit=crop', true, false, '[]'::jsonb, true, false);

  -- ── Patisserie & Decadent Desserts ──
  INSERT INTO public.menu_items (restaurant_id, category_id, name, description, price, image_url, is_available, has_size_variants, size_variants, is_veg, is_bestseller) VALUES
    (v_restaurant_id, v_cat_desserts, 'San Sebastián Basque Burnt Cheesecake', 'Caramelized deep-brown exterior yielding an ultra-creamy, molten vanilla core, finished with fresh wild raspberry coulis.', 290, 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=800&q=80&auto=format&fit=crop', true, false, '[]'::jsonb, true, true),
    (v_restaurant_id, v_cat_desserts, 'Artisan Venetian Tiramisu', 'Savoiardi ladyfingers soaked in Zen espresso & dark cocoa, layered with airy mascarpone sabayon and dusted with single-origin Valrhona cocoa.', 270, 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=800&q=80&auto=format&fit=crop', true, false, '[]'::jsonb, true, true),
    (v_restaurant_id, v_cat_desserts, 'Double-Baked Almond Croissant', 'Twice-baked French butter croissant filled with velvety almond frangipane cream, topped with toasted sliced almonds and powdered sugar.', 210, 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800&q=80&auto=format&fit=crop', true, false, '[]'::jsonb, true, false),
    (v_restaurant_id, v_cat_desserts, 'Belgian 70% Dark Chocolate Truffle Tart', 'Buttery chocolate sable shell filled with silky single-origin dark chocolate ganache, sea salt crystals, and edible gold leaf.', 280, 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=800&q=80&auto=format&fit=crop', true, false, '[]'::jsonb, true, false);

  RAISE NOTICE 'Successfully populated ZenCafe menu for Restaurant ID: %', v_restaurant_id;
END $$;

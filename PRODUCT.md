# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: restaurant staff during service.** Owners, managers and kitchen staff run the dashboard, the kitchen display and table calls in the middle of service, often from a phone during the rush. When a decision has to favour one user, it favours them.

**Secondary: guests at the table.** Diners scan the table QR code, browse the menu, order and follow their order on their own phone. They don't download an app.

**Platform admin.** The operator manages every restaurant from `/admindashboard`.

## Product Purpose

QuickMenu gives a restaurant a QR menu and table ordering. Guests order from the table, the kitchen gets the order instantly, and guests see each step until it's ready. Success means a restaurant can set up and run service on QuickMenu with no tech help and no spending.

## Positioning

- Free for every restaurant, with all features included. There are no plans, tiers or payments.
- India-first: for Indian restaurants of any size, from single cafés to multi-outlet restaurants. Prices are in ₹ and the app locale is `en-IN`.
- The whole order loop is covered: QR menu, ordering, kitchen display, live status for the guest, plus waiter, water and bill calls.

## Operating Context

- Guest flow: scan the QR code (`/scan/:restaurantId`), browse the menu (`/menu/:restaurantId`), order, then follow the status on the phone. The guest's phone vibrates when the order is ready.
- Order statuses: accepted → preparing → ready → completed. Guest-facing copy currently says "Sent to Ready".
- Service calls: guests can request a waiter, water or the bill from the table. Staff get these in real time with sound.
- Staff work from the dashboard (`/dashboard`). Its sections are Overview, Menu, Orders, Kitchen Display, Service Calls, Feedback, Social Links, QR Code and Settings. On mobile it has a bottom tab bar (Home, Orders, Menu, Calls). There is also a standalone kitchen screen (`/kitchen`).
- New orders and calls arrive with sound, badges and toasts. Push notifications through OneSignal are optional and run only on the production domain.
- Staff can install the app on a phone (it's a PWA). It opens on `/dashboard`, with shortcuts to Orders, Kitchen Display and Menu.

## Capabilities and Constraints

- Menu management: categories, toggling item availability, dish photos and a restaurant cover photo (via Cloudinary), and AI menu import (an `ai-menu-import` edge function).
- Restaurant profile, social links, QR code generation, guest feedback and basic stats.
- Admin tools: enable or disable a restaurant's service, and an activity log.
- Stack: React 18, TypeScript and Vite with Tailwind and shadcn/ui. Supabase provides Postgres with row-level security on all tables, realtime, auth and storage.
- The UI is English only, with no i18n layer.
- Guest orders are kept on the guest's device and cleared after 6 hours.
- **Stale docs:** `FEATURES.md` (old "AddMenu" plans) and `.kiro/steering/product.md` (₹199/₹399 plans, Razorpay, a `/menu-dashboard` route) describe a paid model that no longer exists. They are not product truth.

## Brand Commitments

- Name: **QuickMenu**. The footer reads "Made by zenviqdigital.in".
- Existing tagline and copy: "Scan. Order. Eat." and "Your whole menu, one scan away." The current voice is plain, short and concrete ("No app to download.", "with a bell").
- Contact details live on `/about` and `/contact`. Keep them in sync there rather than repeating them elsewhere.

## Evidence on Hand

- Demo video showing the full loop: `public/quickmenu-demo.mp4`, with poster image `public/quickmenu-demo.jpg`.
- Landing screenshot: `docs/landing.jpg`. Sample menu cover: `public/menu-cover.jpg`.
- **Absent, do not fabricate:** testimonials, named customer restaurants, case studies, usage numbers and press.
- **Unverified claims in the current copy:** "99.9% uptime guarantee" (About), "Set up in under 5 minutes" (Landing and About), and the README's performance and "70% cost reduction" figures. Don't repeat or build on them until the owner confirms them.

## Product Principles

1. **Service comes first.** Staff are busy and interrupted, so the next order, call or decision must be obvious at a glance on a phone. Nothing should slow them down mid-rush.
2. **Nothing to install for guests.** A scan opens the menu. The guest side stays light and fast on ordinary phones.
3. **Everyone sees every step.** Order and call states are live and the same for kitchen and guest. A silent or missed update is a product failure.
4. **Free means no upsell.** Every feature is available to every restaurant. Don't add plan gates, upgrade prompts or locked features.
5. **Made for Indian restaurants.** Use ₹ and Indian contact norms (phone, WhatsApp), and build for the range from a single café to a busy multi-outlet kitchen.

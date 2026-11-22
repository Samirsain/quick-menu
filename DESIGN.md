---
name: QuickMenu
description: QR menu and table ordering for Indian restaurants. Scan. Order. Eat.
colors:
  ticket-stamp: "#B0522C"
  stamp-deep: "#8A3A1E"
  stamp-wash: "#F3E2D4"
  slip-paper: "#F5EFE6"
  slip-card: "#FCF8F2"
  carbon-ink: "#2B1D14"
  pencil: "#766558"
  perforation: "#E8DDCF"
  hero-shade: "#18100B"
  label-cream: "#FBF4EA"
  ticket-stamp-night: "#D67446"
  stamp-deep-night: "#B0522C"
  stamp-wash-night: "#422C20"
  slip-paper-night: "#16110D"
  slip-card-night: "#211A15"
  carbon-ink-night: "#F3EBE0"
  pencil-night: "#A89886"
  perforation-night: "#362C23"
  hero-shade-night: "#0C0907"
  veg-green: "#16A34A"
  status-ready: "#34D399"
  status-waiting: "#FBBF24"
  status-late: "#F87171"
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "7rem"
    fontWeight: 500
    lineHeight: 0.95
    letterSpacing: "-0.03em"
  display-menu:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "4.25rem"
    fontWeight: 400
    lineHeight: 1.02
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "1.625rem"
    fontWeight: 400
    lineHeight: 1.25
  body-lead:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.625
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.625
  label-strong:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.25
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
  eyebrow:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.24em"
  badge:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1
rounded:
  thumb: "12px"
  button: "16px"
  card: "20px"
  panel: "24px"
  media: "28px"
  pill: "9999px"
spacing:
  gutter: "16px"
  gutter-lg: "32px"
  card-pad: "24px"
  section: "64px"
  section-lg: "80px"
components:
  button-primary:
    backgroundColor: "{colors.ticket-stamp}"
    textColor: "{colors.label-cream}"
    typography: "{typography.label-strong}"
    rounded: "{rounded.button}"
    height: "48px"
    padding: "0 24px"
  button-hero:
    backgroundColor: "{colors.ticket-stamp}"
    textColor: "{colors.label-cream}"
    typography: "{typography.label-strong}"
    rounded: "{rounded.button}"
    height: "56px"
    padding: "0 32px"
  button-secondary:
    backgroundColor: "{colors.slip-card}"
    textColor: "{colors.carbon-ink}"
    typography: "{typography.label-strong}"
    rounded: "{rounded.button}"
    height: "44px"
    padding: "0 20px"
  chip-category:
    backgroundColor: "{colors.slip-card}"
    textColor: "{colors.carbon-ink}"
    rounded: "{rounded.pill}"
    height: "40px"
    padding: "0 20px"
  chip-category-active:
    backgroundColor: "{colors.ticket-stamp}"
    textColor: "{colors.label-cream}"
    rounded: "{rounded.pill}"
    height: "40px"
    padding: "0 20px"
  input-search:
    backgroundColor: "{colors.slip-card}"
    textColor: "{colors.carbon-ink}"
    rounded: "{rounded.pill}"
    height: "40px"
    padding: "0 16px 0 40px"
  stepper:
    backgroundColor: "{colors.stamp-wash}"
    textColor: "{colors.stamp-deep}"
    rounded: "{rounded.pill}"
    height: "44px"
    padding: "0 12px"
  card:
    backgroundColor: "{colors.slip-card}"
    rounded: "{rounded.card}"
    padding: "{spacing.card-pad}"
---

# Design System: QuickMenu

## Overview

**Creative North Star: "The Order Slip"**

QuickMenu should look and read like a good kitchen ticket: warm paper, one dark ink, and one terracotta stamp that marks what matters. The slip is homely because it comes from the restaurant, not a software vendor. It is exact because a ticket that's misread costs a table its dinner. And it is crisp because a restaurant owner should trust it the way they trust their billing machine.

Density follows the reader. Guests get an unhurried menu with large Fraunces category names, generous card padding and photos. Staff get the same paper and ink packed tighter. Order numbers, tables and timers have to be read in a glance across a counter. Depth is mostly flat: hairline perforation lines separate things, and a warm tinted shadow appears only under the primary action or the hero media.

The guest side (`/`, `/menu/:id`, the service-call button and the UPI card) and the staff dashboard (`/dashboard`) both run on the Order Slip. The shadcn semantic variables (`--primary`, `--background`, `--card` and the rest) are aliases of the `--menu-*` palette in `src/index.css`, so every shared component inherits it. Still off-system: the kitchen display hard-codes near-variants, and `/auth`, `/admindashboard`, About, Contact and the policy pages carry raw Tailwind palette classes (`orange-500`, `gray-*`) on top of the remapped tokens. Those are drift to clear, not a second system.

**Key Characteristics:**
- Warm paper backgrounds with one dark warm-brown ink. No cool greys, no pure black.
- One accent, the Ticket Stamp terracotta, used as a fill for the single most important action.
- Fraunces for names and numbers people look for (restaurants, categories, order numbers). Inter for everything people operate.
- Soft, consistent corners: pills for anything you tap repeatedly, 16px buttons, 20px cards.
- Flat by default. A tinted shadow is reserved for the one thing that should be pressed.
- A full night palette in the same warm family, never a neutral dark theme.

## Colors

A warm-paper palette with one terracotta accent and a dark warm ink. The source of truth is the RGB channel variables `--menu-*` in `src/index.css`, exposed to Tailwind as `menu-*`.

### Primary
- **Ticket Stamp** (`ticket-stamp`, `--menu-accent`): primary action fills, the active category pill, the progress fill, icon tint inside Stamp Wash circles, and the full stops in "Scan. Order. Eat.". At 4.49:1 on Slip Paper it is just under AA for small text, so use it as a fill, an icon or large type, not for small text on paper.
- **Stamp Deep** (`stamp-deep`, `--menu-accent-2`): the far end of the primary gradient and the colour for small terracotta text and links on paper (6.79:1).
- **Stamp Wash** (`stamp-wash`, `--menu-tint`): circles behind icons, the quantity stepper background, and the soft radial glow at the top of the landing page.

### Neutral
- **Slip Paper** (`slip-paper`, `--menu-bg`): the page background everywhere.
- **Slip Card** (`slip-card`, `--menu-card`): cards, sheets, the search field, the bottom bar and secondary buttons. One step lighter than the paper, so surfaces separate without shadows.
- **Carbon Ink** (`carbon-ink`, `--menu-ink`): all primary text (14.26:1 on paper).
- **Pencil** (`pencil`, `--menu-muted`): secondary text such as dish counts, descriptions and helper lines. It gets 5.26:1 on Slip Card and 4.87:1 on Slip Paper.
- **Perforation** (`perforation`, `--menu-line`): hairline borders, dividers, the progress track and skeleton blocks.
- **Hero Shade** (`hero-shade`, `--menu-hero`): the near-black brown base under cover photos and dark hero bands.
- **Label Cream** (`label-cream`): text on Ticket Stamp fills (4.70:1 on Ticket Stamp, 7.11:1 on Stamp Deep). Code currently writes it inline as `#FBF4EA`. Promote it to a variable when you next touch it.

### Night
The `.dark` palette keeps the same roles in the same warm family: `slip-paper-night` and `slip-card-night` for surfaces, `carbon-ink-night` for text (15.87:1), `pencil-night` for muted text (6.70:1), and `ticket-stamp-night` (`#D67446`) as a brighter stamp (5.75:1 on night paper). White or cream text on `ticket-stamp-night` reaches only about 3.3:1, so night fills that carry labels use dark Hero Shade text instead (about 5.9:1). The shared `--primary-foreground` does this automatically in `.dark`.

### Semantic
- **Veg Green** (`veg-green`): the standard Indian vegetarian mark (green square, green dot) on the veg-only filter and dish badges. It's a regulatory convention, not decoration. Never recolour it.
- **Status Ready / Waiting / Late** (`status-ready`, `status-waiting`, `status-late`): the kitchen display's order timers and badges. The timer is neutral under 10 minutes, Waiting from 10 to 20, and Late over 20. Ready is shown as soon as the kitchen marks it. They appear as text on a 15% tint of the same hue. Waiting amber also marks a paused state, such as a table QR that has been stopped. These are the only colours besides terracotta allowed to carry meaning.
- **Order status badges on the dashboard** come from `STATUS_TONE` in `src/lib/orderFlow.ts`, with labels from `STATUS`: New is a Ticket Stamp fill (it needs a decision), Accepted is Perforation, Preparing is Stamp Wash, Ready is green, Served is an outline, and Rejected and Cancelled are red tints.

### Named Rules
**The One Stamp Rule.** Each screen gets one Ticket Stamp fill, for the action that moves the order forward: "Add", "Place order", "Accept" or "Get started". Everything else is Slip Card with a Perforation border.

**The Warm Ink Rule.** Every neutral comes from the paper-and-ink family. A cool grey (`neutral-*`, `gray-*`, `zinc-*`) or a pure `#000` on any screen counts as drift.

**The Meaning-Only Rule.** Green, amber and red appear only when they report real state: veg, ready, waiting, late or error. They are never used for decoration, brand or emphasis.

## Typography

**Display Font:** Fraunces (with Georgia, serif), loaded with the optical-size axis, weights 400, 500 and 600
**Body Font:** Inter (with ui-sans-serif, system-ui)

**Character:** Fraunces brings the homely, hand-set warmth of a restaurant's printed menu. Inter carries the exactness of the ticket. Fraunces names things and Inter operates things, and the two never trade jobs.

### Hierarchy
- **Display** (Fraunces 500, 56px on mobile, 88px on small screens and up, 112px on large, line-height 0.95, tracking -0.03em): the landing hero only. The full stops in "Scan. Order. Eat." are set in Ticket Stamp.
- **Display Menu** (Fraunces 400, 40px on phones, 52px from 640px, 68px from 1024px, line-height 1.02, tracking -0.02em, balanced): the restaurant name over the guest menu cover photo.
- **Headline** (Fraunces 400, 24-30px, line-height 1.25): restaurant names, menu category names (26px), step titles on the landing page, and order numbers on the kitchen display (26px, line-height 1).
- **Body Lead** (Inter 400, 17px rising to 20px, line-height 1.625): the one introductory paragraph under a display headline, max about 42rem wide.
- **Body** (Inter 400, 15px, line-height 1.625): descriptions, list items and the kitchen display's item lines.
- **Label Strong** (Inter 600, 15-16px): button labels and prices.
- **Label** (Inter 500, 13px): meta lines, chips and counts.
- **Badge** (Inter 600, 11px): status badges, count bubbles and the mobile tab labels. Nothing goes smaller.
- **Eyebrow** (Inter 600, 12px, tracking 0.24em, uppercase, Ticket Stamp): used once, above the landing hero.

### Named Rules
**The Names-in-Fraunces Rule.** Fraunces is for things a person scans for by name or number: a restaurant, a category, an order. It is never used for buttons, form labels, tables or body text.

**The One Eyebrow Rule.** The uppercase tracked label appears at most once per page, and only on marketing pages. App screens don't use it.

## Guest Menu Variant (Terracotta + Slate)

The guest menu (/menu/:id) runs a cooler variant so restaurants' menus do not look like every warm-paper template. CustomerMenu adds `.guest` to <html> while open; tokens live in `src/index.css`.

- **Neutrals:** slate paper #F1F3F5, card #FCFCFD, ink #15191E, muted #5B6470, hairline #DEE2E7. Night: #0F1216 / #171B21 / #E9ECEF / #98A1AC / #262C34.
- **Accent:** unchanged terracotta stamp #B0522C (night #E07A4F), still the only accent.
- **Type:** Geist for everything (display at 600, -0.025em tracking). Fraunces and Inter stay on the owner dashboard and landing.

## Layout

The guest menu is a single column on phones. A sticky top bar (Slip Paper at 85% opacity with a strong backdrop blur, Perforation bottom border) holds the search field and category pills, and a blurred Slip Card bar along the bottom carries the cart. At `lg` (1024px) the menu becomes a content column plus a sticky cart panel (`top: 132px`, 24px radius).

Marketing pages sit in a 72rem (1152px) container with 16px side gutters, rising to 32px at `lg`. Sections are 64px apart, rising to 80px. Cards use 24px internal padding. Touch targets are at least 40px, and primary buttons are 48px (56px on the landing page).

Staff screens use a sidebar on desktop and a four-tab bottom bar on mobile (Home, Orders, Menu, Calls). The kitchen display is a dark board of order tickets, sorted by what needs a decision first: pending, then ready, then accepted, then preparing.

Breakpoints are Tailwind's defaults: 640, 768, 1024 and 1280px, with the container capped at 1400px.

## Elevation & Depth

Surfaces are flat and separated by tone (Slip Card on Slip Paper) and Perforation hairlines. Shadows are rare and always tinted with the brown of the ink or the stamp, never grey or black. They mark only the primary action, the active pill, a sticky side panel, or the hero media.

### Shadow Vocabulary
- **Stamp Lift** (`box-shadow: 0 14px 30px -14px rgba(138,58,30,0.7)`): under the primary button.
- **Stamp Lift Hero** (`box-shadow: 0 18px 40px -16px rgba(138,58,30,0.75)`): under the landing "Get started" button.
- **Pill Glow** (`box-shadow: 0 8px 20px -8px rgba(176,82,44,0.8)`): under the active category pill.
- **Panel Rest** (`box-shadow: 0 24px 60px -30px rgba(43,29,20,0.35)`): the sticky desktop cart panel.
- **Media Lift** (`box-shadow: 0 40px 100px -40px rgba(43,29,20,0.55)`): the landing demo video frame.

### Named Rules
**The Pressed-Thing Rule.** A shadow means "this is the thing to press". If an element isn't the primary action or the hero media, it gets a Perforation border instead.

## Shapes

The corners are soft and consistent, in a strict ladder: 12px for thumbnails and for controls 36 to 44px tall (staff buttons, form fields, the shared `Button` and `Input`), 16px for controls 48px and taller (guest buttons, `size="lg"`), 20px cards, 24px panels and sheets, 28px media frames. Anything tapped repeatedly is a full pill: category chips, the search field, the quantity stepper, icon buttons and badges. Icons are Lucide at a stroke of 1.4-1.75 and sit in Stamp Wash circles when they introduce something. Photos are never cropped into odd shapes. Dish photos keep their natural aspect, and logos are circles with a Perforation ring.

## Components

### Buttons
Tactile and warm. They press in slightly rather than lift.
- **Shape:** gently rounded (16px). Primary is 48px tall, and 56px on the landing page.
- **Primary:** a left-to-right gradient from Ticket Stamp to Stamp Deep, with a Label Cream label in Inter 600 at 15-16px and the Stamp Lift shadow. It is full width inside sheets.
- **Staff primary (shared `Button` default):** a solid Ticket Stamp fill with no lift. A staff screen can carry one forward action per order or call (Accept, Start preparing, Mark complete, Done), so the gradient and shadow stay with the guest side and the `hero` variant. Reject and other stopping actions are outline buttons with Danger text.
- **Hover / Active:** hover brightens slightly (`brightness(1.05)`). Active scales to 0.99. Disabled fades in opacity and drops the shadow.
- **Secondary:** Slip Card with a Perforation border and Carbon Ink label at 44px. On hover the border shifts toward Ticket Stamp at 40-50% opacity.
- **Quiet:** text only, in Pencil, turning Carbon Ink on hover. Used for "Not now" and "Maybe later".

### Chips (category pills)
- **Style:** a 40px pill in Inter 500 at 14px with 20px side padding. When idle it is Slip Card with a Perforation border.
- **State:** the active pill is filled with the stamp gradient and the Pill Glow shadow. It slides between chips through a shared layout animation, so the fill travels rather than blinks.
- **Veg-only filter:** a separate pill carrying the Veg Green mark. When on, it fills Veg Green with white text.

### Cards / Containers
- **Corner Style:** 20px. Sheets and panels are 24px.
- **Background:** Slip Card on Slip Paper.
- **Shadow Strategy:** staff cards are flat. Guest dish cards carry a faint warm lift (`0 1px 2px rgba(43,29,20,0.04), 0 12px 28px -20px rgba(43,29,20,0.4)`) so they read as plates on the paper.
- **Border:** a 1px Perforation line, sometimes at 70% opacity.
- **Internal Padding:** 24px.

### Inputs / Fields
- **Style:** the search field is a 40px pill in Slip Card with a Perforation border, a Pencil placeholder, a 40px left inset for the icon, and 15px text.
- **Focus:** the border shifts to Ticket Stamp at 60% opacity, with a colour transition and no glow.
- **Error / Disabled:** not yet set in the guest system. Staff forms still use shadcn defaults.

### Quantity Stepper
A 44px Stamp Wash pill with a terracotta minus, count and plus, in Inter 600 at 14px. The count should use Stamp Deep. The code currently uses Ticket Stamp, which only reaches 4.07:1 on Stamp Wash.

### Navigation
- **Guest top bar:** a 56px row on blurred Slip Paper with a Perforation bottom border. The search opens inline with a Ticket Stamp "Cancel".
- **Guest bottom bar:** blurred Slip Card at 90% opacity with a Perforation top border and safe-area padding. It holds the cart summary and the primary action.
- **Landing nav:** an 80px row with the Leaf mark in a Stamp Wash circle, the Fraunces wordmark at 24px, links in Carbon Ink at 70% opacity, and "Log in" in Stamp Deep.
- **Staff:** a sidebar plus a mobile bottom tab bar. These still use legacy neutral greys and should move to Slip Card with Carbon Ink and Pencil.

### Dish Card (guest)
A dish with a photo shows it uncropped on the left (a blurred copy fills the frame). A dish without a photo is a compact text card, never a letter tile. The veg mark and a Bestseller outline pill (11px, Stamp Deep text, Ticket Stamp border at 35%) sit above the Fraunces name. The price is in Ticket Stamp, and the add control is a Stamp Wash circle that becomes a quantity pill.

### Controls over the cover photo
Back, search, call staff and more share one quiet dark glass circle (`bg-black/30`, blur, white ring at 20%). The table number is a glass chip, not an uppercase label. Terracotta on the hero is kept for the active category pill only.

### Kitchen Ticket (signature)
The kitchen display's order card is the Order Slip at its most literal: the Fraunces order number at 26px, a table pill, and a row of pill badges (NEW in the stamp colour, the status, then a timer in tabular figures that tints Waiting after 10 minutes and Late after 20). Items are listed in 15px Inter. It runs on a night board. The board currently hard-codes near-variants (`#120E0B`, `#C0602F`, `#E08A5C`, `#F3EBE0`) and should switch to the night tokens.

## Do's and Don'ts

### Do:
- **Do** give each screen exactly one Ticket Stamp gradient fill, for the action that moves the order forward.
- **Do** set small terracotta text and links on paper in Stamp Deep (6.79:1), and keep Ticket Stamp for fills, icons and large type.
- **Do** separate surfaces with Slip Card on Slip Paper and a Perforation hairline before reaching for a shadow.
- **Do** tint every shadow with the ink or stamp brown (`rgba(43,29,20,…)` or `rgba(138,58,30,…)`).
- **Do** use the strict corner ladder (12, 16, 20, 24, 28px), with pills for anything tapped repeatedly.
- **Do** set restaurant names, category names and order numbers in Fraunces, and every control, form and table in Inter.
- **Do** ease with `cubic-bezier(0.22, 1, 0.36, 1)` (rise 24px over 0.8s on entry, 0.7s for reveals on scroll) and press with `scale(0.99)`.
- **Do** keep the Indian veg mark in its standard green square-and-dot form.
- **Do**, when bringing staff screens in line, remap shadcn's `--primary`, `--background`, `--card`, `--muted`, `--border` and `--ring` to Order Slip values, rather than restyling each component.

### Don't:
- **Don't** use the legacy shadcn orange `#F98C1F`. White on it reaches 2.39:1.
- **Don't** use the green `#28BD66` as a brand accent, or the pure-black `#000` dark mode.
- **Don't** use violet or purple gradients (currently in AI Menu Import). They are outside the palette.
- **Don't** use cool greys (`neutral-*`, `gray-*`, `zinc-*`) on any screen. Neutrals come from paper and ink.
- **Don't** put white or cream labels on `ticket-stamp-night` (about 3.3:1). Night fills carry dark Hero Shade labels.
- **Don't** give staff cards the stock `shadow-md` or `shadow-lg`. A shadow means "press this".
- **Don't** use bounce or elastic easing (`animate-bounce`) for new-order alerts. Use sound, a badge and a single ease-out entrance.
- **Don't** add a thick coloured stripe along one side of a rounded card. Use a Stamp Wash circle or a tint instead. (The L-shaped corner brackets around a QR preview are a scan frame, not a stripe, and stay.)
- **Don't** use emoji as icons or in UI copy. Toasts and labels use plain words, and icons come from Lucide. Text sent outside the app, such as the WhatsApp report, may keep emoji.
- **Don't** use gradient text.

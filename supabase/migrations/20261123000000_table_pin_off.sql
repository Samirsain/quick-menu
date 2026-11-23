-- The table PIN step is removed from the app: guests scan the QR and order. Switch it off everywhere so
-- join_table takes its no-PIN path (the scan opens the table, or joins the seating already open there).
-- ponytail: the column and the PIN branch in join_table stay but are unused; drop them if PINs never come back.
update public.restaurants set require_table_pin = false where require_table_pin;

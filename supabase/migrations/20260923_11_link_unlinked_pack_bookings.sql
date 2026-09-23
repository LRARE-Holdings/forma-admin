-- STATUS: APPLIED 2026-09-23 (link_unlinked_pack_bookings).
--
-- Data fix from the 2026-09-23 database audit (item 5).
--
-- Six pack-credit bookings made on 2026-09-22 between 06:17 and 08:09 UTC,
-- before the class_pack_id fix was deployed, were saved without the pack they
-- used, and their ledger debits without the booking. The credits WERE taken:
-- each booking has a -1 debit in the same second on the right pack, so
-- balances are correct. Only the links were missing, which matters because a
-- later cancellation re-credits the booking's own pack. Without the link,
-- 451e7ff4's credit went back to a different pack of the same member (that
-- credit was then used, so no one lost out; the refund row stays as it is).
--
-- This only fills in the missing links; no balance changes. Bookings made
-- since then all record their pack.

with links(booking_id, ledger_id, pack_id) as (values
  ('a7a0e593-7d10-45be-9234-198df85d7b33'::uuid, '01f317f6-2f94-43b6-b313-768450860d62'::uuid, '01bc9500-afa8-4dd7-a11b-96aa717b8382'::uuid),
  ('451e7ff4-7240-4f67-9034-9589decf87b4',       '64d0585a-6c77-41c0-96c1-89b7c5a4f976',       'a3ace689-f446-48b0-948b-760fa90dc02a'),
  ('1748f5fd-2f5e-4707-9380-f7465b290c0b',       '6ad0b9e3-9a1d-4279-8ac1-3abd1928bce3',       'a3ace689-f446-48b0-948b-760fa90dc02a'),
  ('320428db-79a4-4043-9a76-56dadcfc65cc',       '6521ff4a-c4bb-4f5b-bbfb-0b7d8b24e869',       'a3ace689-f446-48b0-948b-760fa90dc02a'),
  ('60ff61e7-1c32-4da5-9e3d-46d279b7190f',       'caf39703-bfdb-40ea-b614-b9d77e173b66',       'a3ace689-f446-48b0-948b-760fa90dc02a'),
  ('c504757f-0a99-4a0f-9279-13015d3a60d8',       '3866d937-7d99-4838-876f-d2ce7e648425',       'a3ace689-f446-48b0-948b-760fa90dc02a')
), b as (
  update public.bookings bk set class_pack_id = l.pack_id
    from links l
   where bk.id = l.booking_id and bk.class_pack_id is null
  returning bk.id
)
update public.credit_transactions ct set booking_id = l.booking_id
  from links l
 where ct.id = l.ledger_id and ct.booking_id is null and ct.class_pack_id = l.pack_id;

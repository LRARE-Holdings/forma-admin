-- Per-studio accounting settings for the Money page.
--
-- accounting_year_end: the last day of the studio's accounting year, as MM-DD.
-- Defaults to '04-05' (5 April), the UK tax year end, which is the basis HMRC
-- taxes sole traders on from 2024/25. Days that don't exist every year
-- (29 Feb) or at all (31 Apr) are refused.
--
-- accounting_software: which import format the Money page offers for the
-- Stripe statement download.

alter table public.studios
  add column accounting_year_end text not null default '04-05'
    check (
      accounting_year_end ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
      and accounting_year_end not in ('02-29', '02-30', '02-31', '04-31', '06-31', '09-31', '11-31')
    ),
  add column accounting_software text not null default 'none'
    check (accounting_software in ('none', 'xero', 'quickbooks', 'freeagent'));

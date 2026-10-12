-- =====================================================================
-- stopjeger.hu — publikalasi jog felhasznalonkent
-- Migracio: 2026-10-12  (elofeltetel: 2026-09-11_admin_felulet.sql)
-- Futtatas: Supabase -> SQL Editor, EGYBEN. Utana futtasd le a fajl
-- vegen levo ELLENORZO lekerdezest, es nezd meg, hogy minden sor 'ok'.
-- =====================================================================
--
-- Tervezesi elvek:
--   * Az adminisztrator mindig publikalhat (ezt a kod donti el, nem az
--     oszlop); a szerkeszto csak akkor, ha can_publish = true.
--   * Uj felhasznalo jog nelkul indul (default false).
--   * A MAR MEGLEVO felhasznalok megtartjak a jogot, mert eddig mindenki
--     publikalhatott. A feltoltes csak az oszlop letrehozasakor fut le,
--     igy a migracio ujrafuttatasa nem adja vissza az elvett jogokat.

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'admin_users'
                   and column_name = 'can_publish') then
    alter table public.admin_users add column can_publish boolean not null default false;
    update public.admin_users set can_publish = true;
  end if;
end $$;


-- =====================================================================
-- ELLENORZO LEKERDEZES -- a migracio UTAN, kulon futtasd.
-- Minden sornak 'ok'-nak kell lennie.
-- =====================================================================
-- select 'oszlop: admin_users.can_publish' as elem,
--        case when exists (select 1 from information_schema.columns
--                          where table_schema = 'public' and table_name = 'admin_users'
--                            and column_name = 'can_publish' and data_type = 'boolean'
--                            and is_nullable = 'NO')
--             then 'ok' else 'HIANYZIK' end as allapot
-- union all
-- select 'uj felhasznalo alapertelmezese: false',
--        case when exists (select 1 from information_schema.columns
--                          where table_schema = 'public' and table_name = 'admin_users'
--                            and column_name = 'can_publish' and column_default = 'false')
--             then 'ok' else 'ROSSZ ALAPERTELMEZES' end;

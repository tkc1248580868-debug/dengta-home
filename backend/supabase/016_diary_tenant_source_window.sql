-- A diary source window is unique inside one companion, not globally.
-- The legacy single-user index could make two tenants with matching message
-- timestamps block one another after the multi-tenant migration.

drop index if exists public.companion_diary_source_window_uidx;

create unique index if not exists companion_diary_tenant_source_window_uidx
    on public.companion_diary_entries (
        user_id,
        companion_id,
        source_window_end
    )
    where user_id is not null and companion_id is not null;

comment on index public.companion_diary_tenant_source_window_uidx is
    'Prevents duplicate diary generation for the same tenant source window.';

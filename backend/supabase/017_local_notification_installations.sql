-- Android builds distributed outside an app store need a narrowly scoped,
-- revocable credential for background polling. It is not a Supabase refresh
-- token and cannot be used for chat or settings writes.

alter table public.push_installations
    add column if not exists companion_id uuid,
    add column if not exists token_hash text,
    add column if not exists expires_at timestamptz;

alter table public.push_installations
    alter column token_ciphertext drop not null;

alter table public.push_installations
    drop constraint if exists push_installations_provider_check,
    drop constraint if exists push_installations_installation_id_key;

alter table public.push_installations
    add constraint push_installations_provider_check
    check (provider in ('jpush', 'getui', 'local_poll'));

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'push_installations_companion_fk'
          and conrelid = 'public.push_installations'::regclass
    ) then
        alter table public.push_installations
            add constraint push_installations_companion_fk
            foreign key (user_id, companion_id)
            references public.companions(user_id, id)
            on delete cascade;
    end if;
end
$$;

create unique index if not exists push_installations_provider_device_uidx
    on public.push_installations (
        user_id,
        companion_id,
        provider,
        installation_id
    );

create unique index if not exists push_installations_local_token_uidx
    on public.push_installations (token_hash)
    where provider = 'local_poll'
      and token_hash is not null;

create index if not exists push_installations_local_active_idx
    on public.push_installations (user_id, companion_id, expires_at)
    where provider = 'local_poll'
      and enabled = true
      and revoked_at is null;

comment on column public.push_installations.token_hash is
    'SHA-256 hash of a local Android polling credential; plaintext is returned once and never stored.';
comment on column public.push_installations.expires_at is
    'Hard expiry for a background installation credential.';

-- DengTa Home 2.0: staged multi-tenant foundation.
--
-- Stage order:
--   1. Apply this migration while the legacy service-role backend is online.
--   2. Register and verify the owner through Supabase Auth.
--   3. Deploy the tenant-aware backend with INITIAL_OWNER_EMAIL configured.
--   4. The backend calls finalize_legacy_owner_migration(owner_user_id).
--   5. Verify counts and ownership, then apply 013_multitenant_finalize.sql.
--
-- Repeatability: this additive foundation may be reapplied before or after
-- finalization. It never calls the owner backfill automatically; create/alter
-- operations and policies are written to converge on the same schema.
--
-- Existing rows intentionally remain nullable during the staging window. RLS
-- makes unassigned rows invisible to authenticated browser clients, while the
-- service-role backend can finish the controlled owner migration.

create table if not exists public.user_profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null default '',
    display_name text not null default '',
    role text not null default 'member'
        check (role in ('owner', 'admin', 'member')),
    status text not null default 'active'
        check (status in ('active', 'pending_deletion', 'disabled')),
    companion_limit integer not null default 1
        check (companion_limit between 1 and 5),
    storage_used_bytes bigint not null default 0
        check (storage_used_bytes >= 0),
    storage_quota_bytes bigint generated always as (
        companion_limit::bigint * 262144000::bigint
    ) stored,
    deletion_requested_at timestamptz,
    deletion_scheduled_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists user_profiles_single_owner
    on public.user_profiles (role)
    where role = 'owner';

create table if not exists public.companions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.user_profiles(id) on delete cascade,
    name text not null default '我的伴侣'
        check (char_length(name) between 1 and 80),
    is_default boolean not null default false,
    status text not null default 'active'
        check (status in ('active', 'archived')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, id)
);

create unique index if not exists companions_single_default_per_user
    on public.companions (user_id)
    where is_default = true and status = 'active';

create table if not exists public.companion_profile_versions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    version integer not null check (version > 0),
    profile jsonb not null default '{}'::jsonb,
    evidence jsonb not null default '[]'::jsonb,
    change_reason text not null default '',
    confirmed_identity_change boolean not null default false,
    created_at timestamptz not null default now(),
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    unique (companion_id, version)
);

create table if not exists public.stable_memory_candidates (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    summary text not null,
    source_message_ids jsonb not null default '[]'::jsonb,
    status text not null default 'pending'
        check (status in ('pending', 'confirmed', 'rejected')),
    decided_at timestamptz,
    created_at timestamptz not null default now(),
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade
);

create table if not exists public.media_assets (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    conversation_id uuid references public.conversations(id) on delete cascade,
    message_id bigint references public.messages(id) on delete set null,
    storage_bucket text not null,
    storage_path text not null,
    media_kind text not null
        check (media_kind in ('image', 'video', 'audio', 'file', 'drawing')),
    mime_type text not null default 'application/octet-stream',
    byte_size bigint not null check (byte_size >= 0),
    sha256 text not null default '',
    visual_summary jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    deleted_at timestamptz,
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    unique (storage_bucket, storage_path)
);

create index if not exists media_assets_recent_conversation_idx
    on public.media_assets (user_id, companion_id, conversation_id, created_at desc)
    where deleted_at is null;

create table if not exists public.push_installations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.user_profiles(id) on delete cascade,
    installation_id uuid not null,
    provider text not null check (provider in ('jpush', 'getui')),
    token_ciphertext text not null,
    platform text not null default 'android'
        check (platform = 'android'),
    app_version text not null default '',
    enabled boolean not null default true,
    last_seen_at timestamptz not null default now(),
    revoked_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (installation_id)
);

create table if not exists public.background_jobs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    job_type text not null check (
        job_type in (
            'proactive_message',
            'moment_post',
            'moment_interaction',
            'diary_update',
            'profile_refresh',
            'surprise_reveal'
        )
    ),
    due_at timestamptz not null,
    dedupe_key text not null,
    status text not null default 'pending'
        check (status in ('pending', 'running', 'completed', 'cancelled', 'failed')),
    payload jsonb not null default '{}'::jsonb,
    attempt_count integer not null default 0 check (attempt_count >= 0),
    locked_at timestamptz,
    locked_by text,
    lease_id uuid,
    lease_expires_at timestamptz,
    last_error_code text,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    unique (user_id, companion_id, dedupe_key)
);

create index if not exists background_jobs_due_idx
    on public.background_jobs (status, due_at)
    where status = 'pending';

create table if not exists public.delivery_events (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    message_id bigint references public.messages(id) on delete set null,
    installation_id uuid,
    dedupe_key text not null,
    provider text,
    state text not null default 'saved'
        check (state in ('saved', 'queued', 'sent', 'delivered', 'failed', 'opened')),
    provider_message_id text,
    error_code text,
    attempted_at timestamptz,
    delivered_at timestamptz,
    opened_at timestamptz,
    created_at timestamptz not null default now(),
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    unique (dedupe_key, installation_id)
);

create table if not exists public.companion_slot_codes (
    id uuid primary key default gen_random_uuid(),
    code_digest text not null unique,
    slots integer not null default 1 check (slots between 1 and 4),
    status text not null default 'active'
        check (status in ('active', 'redeemed', 'revoked', 'expired')),
    expires_at timestamptz,
    redeemed_by uuid references public.user_profiles(id),
    redeemed_at timestamptz,
    created_by uuid references public.user_profiles(id),
    created_at timestamptz not null default now()
);

-- Add the ownership chain to every legacy business table.
alter table if exists public.settings
    add column if not exists user_id uuid references public.user_profiles(id);
alter table if exists public.settings
    add column if not exists companion_id uuid references public.companions(id);

alter table if exists public.conversations
    add column if not exists user_id uuid references public.user_profiles(id);
alter table if exists public.conversations
    add column if not exists companion_id uuid references public.companions(id);
alter table if exists public.conversations
    add column if not exists model_id text;

alter table if exists public.memories
    add column if not exists user_id uuid references public.user_profiles(id);
alter table if exists public.memories
    add column if not exists companion_id uuid references public.companions(id);
alter table if exists public.memories
    add column if not exists confirmation_status text not null default 'confirmed'
        check (confirmation_status in ('candidate', 'confirmed', 'rejected'));

alter table if exists public.messages
    add column if not exists user_id uuid references public.user_profiles(id);
alter table if exists public.messages
    add column if not exists companion_id uuid references public.companions(id);
alter table if exists public.messages
    add column if not exists reply_to_message_id bigint references public.messages(id)
        on delete set null;
alter table if exists public.messages
    add column if not exists reply_snapshot jsonb not null default '{}'::jsonb;

alter table if exists public.moments
    add column if not exists user_id uuid references public.user_profiles(id);
alter table if exists public.moments
    add column if not exists companion_id uuid references public.companions(id);

alter table if exists public.moment_comments
    add column if not exists user_id uuid references public.user_profiles(id);
alter table if exists public.moment_comments
    add column if not exists companion_id uuid references public.companions(id);

alter table if exists public.companion_diary_entries
    add column if not exists user_id uuid references public.user_profiles(id);
alter table if exists public.companion_diary_entries
    add column if not exists companion_id uuid references public.companions(id);

alter table if exists public.mcp_connections
    add column if not exists user_id uuid references public.user_profiles(id);
alter table if exists public.mcp_connections
    add column if not exists companion_id uuid references public.companions(id);

alter table if exists public.ai_provider_profiles
    add column if not exists user_id uuid references public.user_profiles(id);
alter table if exists public.ai_provider_profiles
    add column if not exists companion_id uuid references public.companions(id);

-- Legacy global uniqueness must become tenant scoped.
alter table if exists public.mcp_connections
    drop constraint if exists mcp_connections_slug_key;
drop index if exists public.mcp_connections_slug_key;
create unique index if not exists mcp_connections_tenant_slug_uidx
    on public.mcp_connections (user_id, companion_id, slug)
    where user_id is not null and companion_id is not null;

alter table if exists public.ai_provider_profiles
    drop constraint if exists ai_provider_profiles_slug_key;
drop index if exists public.ai_provider_profiles_slug_key;
drop index if exists public.ai_provider_profiles_single_default;
create unique index if not exists ai_provider_profiles_tenant_slug_uidx
    on public.ai_provider_profiles (user_id, companion_id, slug)
    where user_id is not null and companion_id is not null;
create unique index if not exists ai_provider_profiles_tenant_default_uidx
    on public.ai_provider_profiles (user_id, companion_id)
    where is_default = true and user_id is not null and companion_id is not null;

drop index if exists public.companion_diary_source_window_uidx;
create unique index if not exists companion_diary_tenant_window_uidx
    on public.companion_diary_entries (companion_id, source_window_end)
    where companion_id is not null;

create index if not exists conversations_tenant_recent_idx
    on public.conversations (user_id, companion_id, updated_at desc);
create index if not exists messages_tenant_conversation_idx
    on public.messages (user_id, companion_id, conversation_id, created_at desc);
create index if not exists moments_tenant_recent_idx
    on public.moments (user_id, companion_id, created_at desc);
create unique index if not exists settings_tenant_singleton_uidx
    on public.settings (user_id, companion_id)
    where user_id is not null and companion_id is not null;

-- Replace the legacy global client-message uniqueness from migration 006.
-- During the staged window, unassigned legacy writes keep their original
-- exactly-once behavior. Assigned rows may reuse a client UUID in a different
-- tenant, but never inside the same user/companion boundary.
create unique index if not exists messages_tenant_client_message_uidx
    on public.messages (user_id, companion_id, client_message_id)
    where client_message_id is not null
      and user_id is not null
      and companion_id is not null;
create unique index if not exists messages_staged_client_message_uidx
    on public.messages (client_message_id)
    where client_message_id is not null
      and (user_id is null or companion_id is null);

create unique index if not exists messages_tenant_chat_reply_client_uidx
    on public.messages (
        user_id,
        companion_id,
        (tool_calls ->> 'reply_to_client_message_id')
    )
    where role = 'assistant'
      and tool_calls ? 'reply_to_client_message_id'
      and user_id is not null
      and companion_id is not null;
create unique index if not exists messages_staged_chat_reply_client_uidx
    on public.messages ((tool_calls ->> 'reply_to_client_message_id'))
    where role = 'assistant'
      and tool_calls ? 'reply_to_client_message_id'
      and (user_id is null or companion_id is null);

create unique index if not exists moments_tenant_source_client_message_uidx
    on public.moments (user_id, companion_id, source_client_message_id)
    where source_client_message_id is not null
      and user_id is not null
      and companion_id is not null;
create unique index if not exists moments_staged_source_client_message_uidx
    on public.moments (source_client_message_id)
    where source_client_message_id is not null
      and (user_id is null or companion_id is null);

drop index if exists public.messages_client_message_id_uidx;
drop index if exists public.messages_chat_reply_client_uidx;
drop index if exists public.moments_source_client_message_uidx;

-- Tenant-aware overloads are used by the authenticated backend during the
-- staging window and after finalization. Migration 013 removes the legacy
-- unscoped overloads once all ownership columns are required.
create or replace function public.claim_chat_generation(
    p_user_id uuid,
    p_companion_id uuid,
    p_client_message_id uuid,
    p_lease_id uuid,
    p_lease_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_now timestamptz := clock_timestamp();
    v_seconds integer := greatest(60, least(coalesce(p_lease_seconds, 600), 3600));
    v_message public.messages%rowtype;
begin
    if p_user_id is null or p_companion_id is null then
        raise exception 'chat_generation_tenant_required';
    end if;

    update public.messages as m
    set chat_generation_state = 'in_progress',
        chat_generation_lease_id = p_lease_id,
        chat_generation_lease_expires_at =
            v_now + make_interval(secs => v_seconds),
        chat_generation_started_at = v_now,
        chat_generation_failed_at = null,
        chat_generation_completed_at = null
    where m.user_id = p_user_id
      and m.companion_id = p_companion_id
      and m.client_message_id = p_client_message_id
      and m.role = 'user'
      and (
          m.chat_generation_state is null
          or m.chat_generation_state = 'failed'
          or (
              m.chat_generation_state = 'in_progress'
              and coalesce(
                  m.chat_generation_lease_expires_at,
                  '-infinity'::timestamptz
              ) <= v_now
          )
      )
    returning m.* into v_message;

    if found then
        return jsonb_build_object(
            'claimed', true,
            'message', to_jsonb(v_message)
        );
    end if;

    select m.*
    into v_message
    from public.messages as m
    where m.user_id = p_user_id
      and m.companion_id = p_companion_id
      and m.client_message_id = p_client_message_id
      and m.role = 'user'
    limit 1;

    return jsonb_build_object(
        'claimed', false,
        'message', case
            when v_message.id is null then null
            else to_jsonb(v_message)
        end
    );
end;
$$;

create or replace function public.renew_chat_generation_lease(
    p_user_id uuid,
    p_companion_id uuid,
    p_client_message_id uuid,
    p_lease_id uuid,
    p_lease_seconds integer default 600
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_renewed boolean := false;
    v_seconds integer := greatest(60, least(coalesce(p_lease_seconds, 600), 3600));
begin
    if p_user_id is null or p_companion_id is null then
        raise exception 'chat_generation_tenant_required';
    end if;

    update public.messages as m
    set chat_generation_lease_expires_at =
        clock_timestamp() + make_interval(secs => v_seconds)
    where m.user_id = p_user_id
      and m.companion_id = p_companion_id
      and m.client_message_id = p_client_message_id
      and m.role = 'user'
      and m.chat_generation_state = 'in_progress'
      and m.chat_generation_lease_id = p_lease_id
    returning true into v_renewed;

    return coalesce(v_renewed, false);
end;
$$;

create or replace function public.commit_chat_generation_reply(
    p_user_id uuid,
    p_companion_id uuid,
    p_client_message_id uuid,
    p_lease_id uuid,
    p_content text,
    p_tool_calls jsonb,
    p_visible boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_now timestamptz := clock_timestamp();
    v_user public.messages%rowtype;
    v_assistant public.messages%rowtype;
begin
    if p_user_id is null or p_companion_id is null then
        raise exception 'chat_generation_tenant_required';
    end if;

    select m.*
    into v_user
    from public.messages as m
    where m.user_id = p_user_id
      and m.companion_id = p_companion_id
      and m.client_message_id = p_client_message_id
      and m.role = 'user'
    for update;

    if not found then
        return jsonb_build_object(
            'committed', false,
            'reason', 'user_message_not_found'
        );
    end if;

    select m.*
    into v_assistant
    from public.messages as m
    where m.user_id = p_user_id
      and m.companion_id = p_companion_id
      and m.conversation_id = v_user.conversation_id
      and m.role = 'assistant'
      and m.tool_calls @> jsonb_build_object(
          'reply_to_client_message_id', p_client_message_id::text
      )
    order by m.created_at asc
    limit 1;

    if found then
        update public.messages as m
        set chat_generation_state = 'completed',
            chat_generation_lease_id = null,
            chat_generation_lease_expires_at = null,
            chat_generation_completed_at = coalesce(
                m.chat_generation_completed_at,
                v_now
            )
        where m.id = v_user.id
          and m.user_id = p_user_id
          and m.companion_id = p_companion_id;

        return jsonb_build_object(
            'committed', true,
            'deduplicated', true,
            'assistant_message', to_jsonb(v_assistant)
        );
    end if;

    if v_user.chat_generation_state <> 'in_progress'
       or v_user.chat_generation_lease_id is distinct from p_lease_id then
        return jsonb_build_object(
            'committed', false,
            'reason', 'lease_not_owned'
        );
    end if;

    insert into public.messages (
        user_id,
        companion_id,
        conversation_id,
        role,
        content,
        visible,
        tool_calls
    )
    values (
        v_user.user_id,
        v_user.companion_id,
        v_user.conversation_id,
        'assistant',
        p_content,
        p_visible,
        coalesce(p_tool_calls, '{}'::jsonb) || jsonb_build_object(
            'reply_to_client_message_id',
            p_client_message_id::text
        )
    )
    on conflict do nothing
    returning * into v_assistant;

    if not found then
        select m.*
        into v_assistant
        from public.messages as m
        where m.user_id = p_user_id
          and m.companion_id = p_companion_id
          and m.conversation_id = v_user.conversation_id
          and m.role = 'assistant'
          and m.tool_calls @> jsonb_build_object(
              'reply_to_client_message_id', p_client_message_id::text
          )
        order by m.created_at asc
        limit 1;
    end if;

    if v_assistant.id is null then
        return jsonb_build_object(
            'committed', false,
            'reason', 'assistant_insert_failed'
        );
    end if;

    update public.messages as m
    set chat_generation_state = 'completed',
        chat_generation_lease_id = null,
        chat_generation_lease_expires_at = null,
        chat_generation_completed_at = v_now
    where m.id = v_user.id
      and m.user_id = p_user_id
      and m.companion_id = p_companion_id
      and m.chat_generation_state = 'in_progress'
      and m.chat_generation_lease_id = p_lease_id;

    return jsonb_build_object(
        'committed', true,
        'deduplicated', false,
        'assistant_message', to_jsonb(v_assistant)
    );
end;
$$;

create or replace function public.fail_chat_generation_lease(
    p_user_id uuid,
    p_companion_id uuid,
    p_client_message_id uuid,
    p_lease_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_failed boolean := false;
begin
    if p_user_id is null or p_companion_id is null then
        raise exception 'chat_generation_tenant_required';
    end if;

    update public.messages as m
    set chat_generation_state = 'failed',
        chat_generation_lease_id = null,
        chat_generation_lease_expires_at = null,
        chat_generation_failed_at = clock_timestamp()
    where m.user_id = p_user_id
      and m.companion_id = p_companion_id
      and m.client_message_id = p_client_message_id
      and m.role = 'user'
      and m.chat_generation_state = 'in_progress'
      and m.chat_generation_lease_id = p_lease_id
    returning true into v_failed;

    return coalesce(v_failed, false);
end;
$$;

-- Keep the migration-006 signatures available only for legacy rows that have
-- not entered an ownership boundary yet. This preserves the staged rollout
-- without allowing an old backend to see or mutate assigned tenant rows.
create or replace function public.claim_chat_generation(
    p_client_message_id uuid,
    p_lease_id uuid,
    p_lease_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_now timestamptz := clock_timestamp();
    v_seconds integer := greatest(60, least(coalesce(p_lease_seconds, 600), 3600));
    v_message public.messages%rowtype;
begin
    update public.messages as m
    set chat_generation_state = 'in_progress',
        chat_generation_lease_id = p_lease_id,
        chat_generation_lease_expires_at =
            v_now + make_interval(secs => v_seconds),
        chat_generation_started_at = v_now,
        chat_generation_failed_at = null,
        chat_generation_completed_at = null
    where m.user_id is null
      and m.companion_id is null
      and m.client_message_id = p_client_message_id
      and m.role = 'user'
      and (
          m.chat_generation_state is null
          or m.chat_generation_state = 'failed'
          or (
              m.chat_generation_state = 'in_progress'
              and coalesce(
                  m.chat_generation_lease_expires_at,
                  '-infinity'::timestamptz
              ) <= v_now
          )
      )
    returning m.* into v_message;

    if found then
        return jsonb_build_object(
            'claimed', true,
            'message', to_jsonb(v_message)
        );
    end if;

    select m.*
    into v_message
    from public.messages as m
    where m.user_id is null
      and m.companion_id is null
      and m.client_message_id = p_client_message_id
      and m.role = 'user'
    limit 1;

    return jsonb_build_object(
        'claimed', false,
        'message', case
            when v_message.id is null then null
            else to_jsonb(v_message)
        end
    );
end;
$$;

create or replace function public.renew_chat_generation_lease(
    p_client_message_id uuid,
    p_lease_id uuid,
    p_lease_seconds integer default 600
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_renewed boolean := false;
    v_seconds integer := greatest(60, least(coalesce(p_lease_seconds, 600), 3600));
begin
    update public.messages as m
    set chat_generation_lease_expires_at =
        clock_timestamp() + make_interval(secs => v_seconds)
    where m.user_id is null
      and m.companion_id is null
      and m.client_message_id = p_client_message_id
      and m.role = 'user'
      and m.chat_generation_state = 'in_progress'
      and m.chat_generation_lease_id = p_lease_id
    returning true into v_renewed;

    return coalesce(v_renewed, false);
end;
$$;

create or replace function public.commit_chat_generation_reply(
    p_client_message_id uuid,
    p_lease_id uuid,
    p_content text,
    p_tool_calls jsonb,
    p_visible boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_now timestamptz := clock_timestamp();
    v_user public.messages%rowtype;
    v_assistant public.messages%rowtype;
begin
    select m.*
    into v_user
    from public.messages as m
    where m.user_id is null
      and m.companion_id is null
      and m.client_message_id = p_client_message_id
      and m.role = 'user'
    for update;

    if not found then
        return jsonb_build_object(
            'committed', false,
            'reason', 'user_message_not_found'
        );
    end if;

    select m.*
    into v_assistant
    from public.messages as m
    where m.user_id is null
      and m.companion_id is null
      and m.conversation_id = v_user.conversation_id
      and m.role = 'assistant'
      and m.tool_calls @> jsonb_build_object(
          'reply_to_client_message_id', p_client_message_id::text
      )
    order by m.created_at asc
    limit 1;

    if found then
        update public.messages as m
        set chat_generation_state = 'completed',
            chat_generation_lease_id = null,
            chat_generation_lease_expires_at = null,
            chat_generation_completed_at = coalesce(
                m.chat_generation_completed_at,
                v_now
            )
        where m.id = v_user.id
          and m.user_id is null
          and m.companion_id is null;

        return jsonb_build_object(
            'committed', true,
            'deduplicated', true,
            'assistant_message', to_jsonb(v_assistant)
        );
    end if;

    if v_user.chat_generation_state <> 'in_progress'
       or v_user.chat_generation_lease_id is distinct from p_lease_id then
        return jsonb_build_object(
            'committed', false,
            'reason', 'lease_not_owned'
        );
    end if;

    insert into public.messages (
        conversation_id,
        role,
        content,
        visible,
        tool_calls
    )
    values (
        v_user.conversation_id,
        'assistant',
        p_content,
        p_visible,
        coalesce(p_tool_calls, '{}'::jsonb) || jsonb_build_object(
            'reply_to_client_message_id',
            p_client_message_id::text
        )
    )
    on conflict do nothing
    returning * into v_assistant;

    if not found then
        select m.*
        into v_assistant
        from public.messages as m
        where m.user_id is null
          and m.companion_id is null
          and m.conversation_id = v_user.conversation_id
          and m.role = 'assistant'
          and m.tool_calls @> jsonb_build_object(
              'reply_to_client_message_id', p_client_message_id::text
          )
        order by m.created_at asc
        limit 1;
    end if;

    if v_assistant.id is null then
        return jsonb_build_object(
            'committed', false,
            'reason', 'assistant_insert_failed'
        );
    end if;

    update public.messages as m
    set chat_generation_state = 'completed',
        chat_generation_lease_id = null,
        chat_generation_lease_expires_at = null,
        chat_generation_completed_at = v_now
    where m.id = v_user.id
      and m.user_id is null
      and m.companion_id is null
      and m.chat_generation_state = 'in_progress'
      and m.chat_generation_lease_id = p_lease_id;

    return jsonb_build_object(
        'committed', true,
        'deduplicated', false,
        'assistant_message', to_jsonb(v_assistant)
    );
end;
$$;

create or replace function public.fail_chat_generation_lease(
    p_client_message_id uuid,
    p_lease_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_failed boolean := false;
begin
    update public.messages as m
    set chat_generation_state = 'failed',
        chat_generation_lease_id = null,
        chat_generation_lease_expires_at = null,
        chat_generation_failed_at = clock_timestamp()
    where m.user_id is null
      and m.companion_id is null
      and m.client_message_id = p_client_message_id
      and m.role = 'user'
      and m.chat_generation_state = 'in_progress'
      and m.chat_generation_lease_id = p_lease_id
    returning true into v_failed;

    return coalesce(v_failed, false);
end;
$$;

revoke all on function public.claim_chat_generation(uuid, uuid, uuid, uuid, integer)
    from public, anon, authenticated;
revoke all on function public.renew_chat_generation_lease(uuid, uuid, uuid, uuid, integer)
    from public, anon, authenticated;
revoke all on function public.commit_chat_generation_reply(uuid, uuid, uuid, uuid, text, jsonb, boolean)
    from public, anon, authenticated;
revoke all on function public.fail_chat_generation_lease(uuid, uuid, uuid, uuid)
    from public, anon, authenticated;
revoke all on function public.claim_chat_generation(uuid, uuid, integer)
    from public, anon, authenticated;
revoke all on function public.renew_chat_generation_lease(uuid, uuid, integer)
    from public, anon, authenticated;
revoke all on function public.commit_chat_generation_reply(uuid, uuid, text, jsonb, boolean)
    from public, anon, authenticated;
revoke all on function public.fail_chat_generation_lease(uuid, uuid)
    from public, anon, authenticated;

grant execute on function public.claim_chat_generation(uuid, uuid, uuid, uuid, integer)
    to service_role;
grant execute on function public.renew_chat_generation_lease(uuid, uuid, uuid, uuid, integer)
    to service_role;
grant execute on function public.commit_chat_generation_reply(uuid, uuid, uuid, uuid, text, jsonb, boolean)
    to service_role;
grant execute on function public.fail_chat_generation_lease(uuid, uuid, uuid, uuid)
    to service_role;
grant execute on function public.claim_chat_generation(uuid, uuid, integer)
    to service_role;
grant execute on function public.renew_chat_generation_lease(uuid, uuid, integer)
    to service_role;
grant execute on function public.commit_chat_generation_reply(uuid, uuid, text, jsonb, boolean)
    to service_role;
grant execute on function public.fail_chat_generation_lease(uuid, uuid)
    to service_role;

-- Moments media was public in the legacy tutorial schema. The 2.0 backend
-- serves authorized media; direct public object URLs are no longer allowed.
update storage.buckets
set public = false
where id = 'moments';

-- A new Auth user receives one default companion. Owner promotion is handled
-- by the backend after comparing the verified email with INITIAL_OWNER_EMAIL.
create or replace function public.bootstrap_dengta_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
    insert into public.user_profiles (id, email, display_name)
    values (
        new.id,
        coalesce(new.email, ''),
        coalesce(new.raw_user_meta_data ->> 'display_name', '')
    )
    on conflict (id) do update
    set
        email = excluded.email,
        updated_at = now();

    insert into public.companions (user_id, name, is_default)
    select new.id, '我的伴侣', true
    where not exists (
        select 1 from public.companions where user_id = new.id
    );

    return new;
end;
$$;

drop trigger if exists on_auth_user_created_dengta on auth.users;
create trigger on_auth_user_created_dengta
    after insert or update of email on auth.users
    for each row execute function public.bootstrap_dengta_user();

-- Backfill all legacy single-user rows into the verified owner's default
-- companion. Only the service role can execute this function.
create or replace function public.finalize_legacy_owner_migration(
    p_owner_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_email text;
    v_companion_id uuid;
    v_result jsonb := '{}'::jsonb;
    v_table text;
    v_partial bigint;
begin
    select email into v_email
    from auth.users
    where id = p_owner_user_id
      and email_confirmed_at is not null;

    if v_email is null then
        raise exception 'owner_user_must_have_a_verified_email';
    end if;

    foreach v_table in array array[
        'settings',
        'conversations',
        'memories',
        'messages',
        'moments',
        'moment_comments',
        'companion_diary_entries',
        'mcp_connections',
        'ai_provider_profiles'
    ]
    loop
        execute format(
            'select count(*) from public.%I ' ||
            'where (user_id is null) <> (companion_id is null)',
            v_table
        ) into v_partial;
        if v_partial <> 0 then
            raise exception
                'legacy_owner_migration_blocked: % has % partially assigned rows',
                v_table,
                v_partial;
        end if;
    end loop;

    insert into public.user_profiles (id, email, role, companion_limit)
    values (p_owner_user_id, v_email, 'owner', 1)
    on conflict (id) do update
    set
        email = excluded.email,
        role = 'owner',
        status = 'active',
        updated_at = now();

    select id into v_companion_id
    from public.companions
    where user_id = p_owner_user_id and is_default = true
    order by created_at
    limit 1;

    if v_companion_id is null then
        insert into public.companions (user_id, name, is_default)
        values (p_owner_user_id, '小灯', true)
        returning id into v_companion_id;
    else
        update public.companions
        set name = '小灯', status = 'active', updated_at = now()
        where id = v_companion_id;
    end if;

    update public.settings
    set user_id = p_owner_user_id, companion_id = v_companion_id
    where user_id is null and companion_id is null;
    v_result := v_result || jsonb_build_object('settings', found);

    update public.conversations
    set user_id = p_owner_user_id, companion_id = v_companion_id
    where user_id is null and companion_id is null;
    v_result := v_result || jsonb_build_object(
        'conversations',
        (select count(*) from public.conversations
         where user_id = p_owner_user_id and companion_id = v_companion_id)
    );

    update public.memories
    set user_id = p_owner_user_id, companion_id = v_companion_id
    where user_id is null and companion_id is null;
    update public.messages
    set user_id = p_owner_user_id, companion_id = v_companion_id
    where user_id is null and companion_id is null;
    update public.moments
    set user_id = p_owner_user_id, companion_id = v_companion_id
    where user_id is null and companion_id is null;
    update public.moment_comments
    set user_id = p_owner_user_id, companion_id = v_companion_id
    where user_id is null and companion_id is null;
    update public.companion_diary_entries
    set user_id = p_owner_user_id, companion_id = v_companion_id
    where user_id is null and companion_id is null;
    update public.mcp_connections
    set user_id = p_owner_user_id, companion_id = v_companion_id
    where user_id is null and companion_id is null;
    update public.ai_provider_profiles
    set user_id = p_owner_user_id, companion_id = v_companion_id
    where user_id is null and companion_id is null;

    v_result := v_result || jsonb_build_object(
        'owner_user_id', p_owner_user_id,
        'companion_id', v_companion_id,
        'memories', (
            select count(*) from public.memories
            where user_id = p_owner_user_id and companion_id = v_companion_id
        ),
        'messages', (
            select count(*) from public.messages
            where user_id = p_owner_user_id and companion_id = v_companion_id
        ),
        'moments', (
            select count(*) from public.moments
            where user_id = p_owner_user_id and companion_id = v_companion_id
        ),
        'moment_comments', (
            select count(*) from public.moment_comments
            where user_id = p_owner_user_id and companion_id = v_companion_id
        ),
        'diary_entries', (
            select count(*) from public.companion_diary_entries
            where user_id = p_owner_user_id and companion_id = v_companion_id
        )
    );

    return v_result;
end;
$$;

revoke all on function public.bootstrap_dengta_user()
    from public, anon, authenticated;
revoke all on function public.finalize_legacy_owner_migration(uuid)
    from public, anon, authenticated;
grant execute on function public.finalize_legacy_owner_migration(uuid)
    to service_role;

-- Tenant RLS. Sensitive provider and MCP tables remain backend-only.
alter table public.user_profiles enable row level security;
alter table public.companions enable row level security;
alter table public.companion_profile_versions enable row level security;
alter table public.stable_memory_candidates enable row level security;
alter table public.media_assets enable row level security;
alter table public.push_installations enable row level security;
alter table public.background_jobs enable row level security;
alter table public.delivery_events enable row level security;
alter table public.companion_slot_codes enable row level security;

do $$
declare
    v_table text;
begin
    foreach v_table in array array[
        'settings',
        'conversations',
        'memories',
        'messages',
        'moments',
        'moment_comments',
        'companion_diary_entries',
        'mcp_connections',
        'ai_provider_profiles'
    ]
    loop
        execute format('alter table public.%I enable row level security', v_table);
    end loop;
end $$;

drop policy if exists user_profiles_select_own on public.user_profiles;
create policy user_profiles_select_own on public.user_profiles
    for select to authenticated using (id = auth.uid());

drop policy if exists companions_select_own on public.companions;
create policy companions_select_own on public.companions
    for select to authenticated using (user_id = auth.uid());

do $$
declare
    v_table text;
    v_policy text;
begin
    foreach v_table in array array[
        'settings',
        'conversations',
        'memories',
        'messages',
        'moments',
        'moment_comments',
        'companion_diary_entries',
        'companion_profile_versions',
        'stable_memory_candidates'
    ]
    loop
        v_policy := v_table || '_own_rows';
        execute format('drop policy if exists %I on public.%I', v_policy, v_table);
        execute format(
            'create policy %I on public.%I for select to authenticated ' ||
            'using (user_id = auth.uid())',
            v_policy,
            v_table
        );
    end loop;
end $$;

grant select on table public.user_profiles to authenticated;
grant select on table public.companions to authenticated;
grant select on table public.settings to authenticated;
grant select on table public.conversations to authenticated;
grant select on table public.memories to authenticated;
grant select on table public.messages to authenticated;
grant select on table public.moments to authenticated;
grant select on table public.moment_comments to authenticated;
grant select on table public.companion_diary_entries to authenticated;
grant select on table public.companion_profile_versions to authenticated;
grant select on table public.stable_memory_candidates to authenticated;

revoke all on table public.mcp_connections from anon, authenticated;
revoke all on table public.ai_provider_profiles from anon, authenticated;
revoke all on table public.media_assets from anon, authenticated;
revoke all on table public.push_installations from anon, authenticated;
revoke all on table public.background_jobs from anon, authenticated;
revoke all on table public.delivery_events from anon, authenticated;
revoke all on table public.companion_slot_codes from anon, authenticated;
grant all on table public.mcp_connections to service_role;
grant all on table public.ai_provider_profiles to service_role;
grant all on table public.media_assets to service_role;
grant all on table public.push_installations to service_role;
grant all on table public.background_jobs to service_role;
grant all on table public.delivery_events to service_role;
grant all on table public.companion_slot_codes to service_role;

comment on function public.finalize_legacy_owner_migration(uuid) is
    'Assigns all staged legacy single-user rows to one verified owner and the owner default companion. Service role only.';

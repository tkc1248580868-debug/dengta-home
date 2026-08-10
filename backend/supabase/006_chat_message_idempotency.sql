-- DengTa home 0.9.2: exactly-once user submission and fenced AI generation.
-- Run once in Supabase SQL Editor before deploying the matching backend.

alter table if exists public.messages
    add column if not exists client_message_id uuid;

alter table if exists public.messages
    add column if not exists chat_generation_state text;

alter table if exists public.messages
    add column if not exists chat_generation_lease_id uuid;

alter table if exists public.messages
    add column if not exists chat_generation_lease_expires_at timestamptz;

alter table if exists public.messages
    add column if not exists chat_generation_started_at timestamptz;

alter table if exists public.messages
    add column if not exists chat_generation_failed_at timestamptz;

alter table if exists public.messages
    add column if not exists chat_generation_completed_at timestamptz;

alter table if exists public.moments
    add column if not exists source_client_message_id uuid;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'messages_chat_generation_state_check'
          and conrelid = 'public.messages'::regclass
    ) then
        alter table public.messages
            add constraint messages_chat_generation_state_check
            check (
                chat_generation_state is null
                or chat_generation_state in ('in_progress', 'failed', 'completed')
            );
    end if;
end $$;

-- These legacy global indexes are only valid before ownership columns exist.
-- Migration 012 replaces them with tenant-aware and staged compatibility
-- indexes. Skipping them on a finalized database keeps full-chain recovery
-- repeatable after different tenants have reused the same client UUID.
do $$
begin
    if not exists (
        select 1
        from pg_attribute
        where attrelid = 'public.messages'::regclass
          and attname = 'user_id'
          and not attisdropped
    ) then
        create unique index if not exists messages_client_message_id_uidx
            on public.messages (client_message_id)
            where client_message_id is not null;

        create unique index if not exists messages_chat_reply_client_uidx
            on public.messages ((tool_calls ->> 'reply_to_client_message_id'))
            where role = 'assistant'
              and tool_calls ? 'reply_to_client_message_id';
    end if;

    if not exists (
        select 1
        from pg_attribute
        where attrelid = 'public.moments'::regclass
          and attname = 'user_id'
          and not attisdropped
    ) then
        create unique index if not exists moments_source_client_message_uidx
            on public.moments (source_client_message_id)
            where source_client_message_id is not null;
    end if;
end $$;

comment on column public.messages.client_message_id is
    'Stable client UUID used to deduplicate retried user chat submissions.';

comment on column public.messages.chat_generation_lease_id is
    'Fencing token held by the Render instance currently generating the reply.';

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
    where m.client_message_id = p_client_message_id
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
    where m.client_message_id = p_client_message_id
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
    where m.client_message_id = p_client_message_id
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
    where m.client_message_id = p_client_message_id
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
    where m.conversation_id = v_user.conversation_id
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
        where m.id = v_user.id;

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
        coalesce(p_tool_calls, '{}'::jsonb)
    )
    on conflict do nothing
    returning * into v_assistant;

    if not found then
        select m.*
        into v_assistant
        from public.messages as m
        where m.conversation_id = v_user.conversation_id
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
    where m.client_message_id = p_client_message_id
      and m.role = 'user'
      and m.chat_generation_state = 'in_progress'
      and m.chat_generation_lease_id = p_lease_id
    returning true into v_failed;

    return coalesce(v_failed, false);
end;
$$;

revoke all on function public.claim_chat_generation(uuid, uuid, integer)
    from public, anon, authenticated;
revoke all on function public.renew_chat_generation_lease(uuid, uuid, integer)
    from public, anon, authenticated;
revoke all on function public.commit_chat_generation_reply(uuid, uuid, text, jsonb, boolean)
    from public, anon, authenticated;
revoke all on function public.fail_chat_generation_lease(uuid, uuid)
    from public, anon, authenticated;

grant execute on function public.claim_chat_generation(uuid, uuid, integer)
    to service_role;
grant execute on function public.renew_chat_generation_lease(uuid, uuid, integer)
    to service_role;
grant execute on function public.commit_chat_generation_reply(uuid, uuid, text, jsonb, boolean)
    to service_role;
grant execute on function public.fail_chat_generation_lease(uuid, uuid)
    to service_role;

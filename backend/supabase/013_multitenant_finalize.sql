-- DengTa Home 2.0: final ownership constraints.
--
-- Apply only after:
--   select public.finalize_legacy_owner_migration('<verified-owner-uuid>');
-- and after the migration rehearsal/count checks have passed.
--
-- Repeatability: this finalizer may be reapplied after a successful backfill.
-- It deliberately aborts before changing constraints whenever any legacy row
-- is unassigned, so rerunning it never hides an incomplete owner migration.

do $$
declare
    v_table text;
    v_missing bigint;
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
        execute format(
            'select count(*) from public.%I where user_id is null or companion_id is null',
            v_table
        ) into v_missing;
        if v_missing <> 0 then
            raise exception 'tenant_finalize_blocked: % has % unassigned rows',
                v_table,
                v_missing;
        end if;
    end loop;
end $$;

alter table public.settings
    alter column user_id set not null,
    alter column companion_id set not null;
alter table public.conversations
    alter column user_id set not null,
    alter column companion_id set not null;
alter table public.memories
    alter column user_id set not null,
    alter column companion_id set not null;
alter table public.messages
    alter column user_id set not null,
    alter column companion_id set not null;
alter table public.moments
    alter column user_id set not null,
    alter column companion_id set not null;
alter table public.moment_comments
    alter column user_id set not null,
    alter column companion_id set not null;
alter table public.companion_diary_entries
    alter column user_id set not null,
    alter column companion_id set not null;
alter table public.mcp_connections
    alter column user_id set not null,
    alter column companion_id set not null;
alter table public.ai_provider_profiles
    alter column user_id set not null,
    alter column companion_id set not null;

-- Composite ownership foreign keys prevent a companion from another user
-- being attached to an otherwise user-owned row.
do $$
declare
    v_table text;
    v_constraint text;
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
        v_constraint := v_table || '_tenant_companion_fk';
        if not exists (
            select 1
            from pg_constraint
            where conname = v_constraint
              and conrelid = format('public.%I', v_table)::regclass
        ) then
            execute format(
                'alter table public.%I add constraint %I ' ||
                'foreign key (user_id, companion_id) ' ||
                'references public.companions(user_id, id) on delete cascade',
                v_table,
                v_constraint
            );
        end if;
    end loop;
end $$;

-- Finalization closes the staged compatibility path. From this point onward
-- every generation lease operation must provide a tenant, and the nullable
-- legacy uniqueness indexes no longer serve any row.
drop function if exists public.claim_chat_generation(uuid, uuid, integer);
drop function if exists public.renew_chat_generation_lease(uuid, uuid, integer);
drop function if exists public.commit_chat_generation_reply(uuid, uuid, text, jsonb, boolean);
drop function if exists public.fail_chat_generation_lease(uuid, uuid);

drop index if exists public.messages_staged_client_message_uidx;
drop index if exists public.messages_staged_chat_reply_client_uidx;
drop index if exists public.moments_staged_source_client_message_uidx;

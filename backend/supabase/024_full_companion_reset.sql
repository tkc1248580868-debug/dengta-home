alter table if exists public.settings
    alter column system_prompt set default '',
    alter column personality set default '';

alter table if exists public.settings
    alter column prompt_mode set default 'unified';

create or replace function public.reset_dengta_companion_state(
    p_auth_uid uuid,
    p_companion_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
    v_settings public.settings%rowtype;
    v_cutoff timestamptz;
    v_background_jobs integer := 0;
    v_delivery_events integer := 0;
    v_stable_memory_candidates integer := 0;
    v_companion_profile_versions integer := 0;
    v_memories integer := 0;
    v_conversation_composer_hints integer := 0;
    v_moment_comments integer := 0;
    v_moments integer := 0;
    v_diary_entries integer := 0;
    v_messages integer := 0;
    v_conversations integer := 0;
begin
    if p_auth_uid is null or p_companion_id is null then
        raise exception 'companion_reset_tenant_required';
    end if;

    select settings.*
    into v_settings
    from public.settings as settings
    where settings.user_id = p_auth_uid
      and settings.companion_id = p_companion_id
    for update;

    if not found then
        raise exception 'companion_reset_settings_not_found';
    end if;

    v_cutoff := clock_timestamp();

    delete from public.background_jobs as job
    where job.user_id = p_auth_uid
      and job.companion_id = p_companion_id;
    get diagnostics v_background_jobs = row_count;

    delete from public.delivery_events as event
    where event.user_id = p_auth_uid
      and event.companion_id = p_companion_id;
    get diagnostics v_delivery_events = row_count;

    delete from public.stable_memory_candidates as candidate
    where candidate.user_id = p_auth_uid
      and candidate.companion_id = p_companion_id;
    get diagnostics v_stable_memory_candidates = row_count;

    delete from public.companion_profile_versions as profile
    where profile.user_id = p_auth_uid
      and profile.companion_id = p_companion_id;
    get diagnostics v_companion_profile_versions = row_count;

    delete from public.memories as memory
    where memory.user_id = p_auth_uid
      and memory.companion_id = p_companion_id;
    get diagnostics v_memories = row_count;

    delete from public.conversation_composer_hints as hint
    where hint.user_id = p_auth_uid
      and hint.companion_id = p_companion_id;
    get diagnostics v_conversation_composer_hints = row_count;

    select count(*)::integer
    into v_moment_comments
    from public.moment_comments as comment
    where comment.user_id = p_auth_uid
      and comment.companion_id = p_companion_id;

    delete from public.moments as moment
    where moment.user_id = p_auth_uid
      and moment.companion_id = p_companion_id;
    get diagnostics v_moments = row_count;

    delete from public.companion_diary_entries as diary
    where diary.user_id = p_auth_uid
      and diary.companion_id = p_companion_id;
    get diagnostics v_diary_entries = row_count;

    update public.media_assets as asset
    set conversation_id = null,
        message_id = null
    where asset.user_id = p_auth_uid
      and asset.companion_id = p_companion_id
      and (asset.conversation_id is not null or asset.message_id is not null);

    select count(*)::integer
    into v_messages
    from public.messages as message
    where message.user_id = p_auth_uid
      and message.companion_id = p_companion_id;

    delete from public.conversations as conversation
    where conversation.user_id = p_auth_uid
      and conversation.companion_id = p_companion_id;
    get diagnostics v_conversations = row_count;

    update public.settings as settings
    set system_prompt = '',
        additional_prompt = '',
        personality = '',
        prompt_mode = 'unified',
        unified_system_prompt = '',
        user_details = '',
        context_reset_at = v_cutoff,
        updated_at = v_cutoff
    where settings.id = v_settings.id
      and settings.user_id = p_auth_uid
      and settings.companion_id = p_companion_id;

    if not found then
        raise exception 'companion_reset_settings_update_failed';
    end if;

    return jsonb_build_object(
        'cutoff', v_cutoff,
        'deleted_rows', jsonb_build_object(
            'background_jobs', v_background_jobs,
            'delivery_events', v_delivery_events,
            'stable_memory_candidates', v_stable_memory_candidates,
            'companion_profile_versions', v_companion_profile_versions,
            'memories', v_memories,
            'conversation_composer_hints', v_conversation_composer_hints,
            'moment_comments', v_moment_comments,
            'moments', v_moments,
            'diary_entries', v_diary_entries,
            'messages', v_messages,
            'conversations', v_conversations
        )
    );
end;
$$;

revoke all on function public.reset_dengta_companion_state(uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.reset_dengta_companion_state(uuid, uuid)
    to service_role;

grant select, update on table public.settings to service_role;
grant select, delete on table public.conversations to service_role;
grant select, delete on table public.messages to service_role;
grant select, delete on table public.memories to service_role;
grant select, delete on table public.moments to service_role;
grant select, delete on table public.moment_comments to service_role;
grant select, delete on table public.companion_diary_entries to service_role;
grant select, delete on table public.stable_memory_candidates to service_role;
grant select, delete on table public.companion_profile_versions to service_role;
grant select, delete on table public.conversation_composer_hints to service_role;
grant select, delete on table public.background_jobs to service_role;
grant select, delete on table public.delivery_events to service_role;
grant select, update on table public.media_assets to service_role;

comment on function public.reset_dengta_companion_state(uuid, uuid) is
    'Atomically clears one companion persona, prompts, messages, memories, moments, diary, derived profile, and old response jobs while preserving account, providers, devices, artworks, and nursery data.';

notify pgrst, 'reload schema';

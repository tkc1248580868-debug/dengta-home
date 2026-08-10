alter table if exists public.settings
    add column if not exists context_reset_at timestamptz;

comment on column public.settings.context_reset_at is
    'Inclusive lower bound for AI context and derived learning. Older messages remain available to chat history APIs.';

create or replace function public.reset_dengta_persona_memory(
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
    v_settings_rows_updated integer := 0;
    v_stable_memory_candidates integer := 0;
    v_companion_profile_versions integer := 0;
    v_memories integer := 0;
    v_conversation_composer_hints integer := 0;
    v_context_jobs integer := 0;
    v_context_jobs_by_type jsonb := '{}'::jsonb;
    v_already_reset boolean := false;
begin
    if p_auth_uid is null or p_companion_id is null then
        raise exception 'persona_reset_tenant_required';
    end if;

    select settings.*
    into v_settings
    from public.settings as settings
    where settings.user_id = p_auth_uid
      and settings.companion_id = p_companion_id
    for update;

    if not found then
        raise exception 'persona_reset_settings_not_found';
    end if;

    with deleted as (
        delete from public.background_jobs as job
        where job.user_id = p_auth_uid
          and job.companion_id = p_companion_id
          and job.job_type in (
              'proactive_message',
              'profile_refresh',
              'diary_update',
              'moment_post',
              'creative_check',
              'moment_interaction',
              'surprise_reveal'
          )
          and job.status in ('pending', 'running')
        returning job.job_type
    ),
    grouped as (
        select deleted.job_type, count(*)::integer as deleted_count
        from deleted
        group by deleted.job_type
    )
    select
        coalesce(sum(grouped.deleted_count), 0)::integer,
        coalesce(
            jsonb_object_agg(grouped.job_type, grouped.deleted_count),
            '{}'::jsonb
        )
    into v_context_jobs, v_context_jobs_by_type
    from grouped;

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

    v_already_reset :=
        v_settings.context_reset_at is not null
        and coalesce(v_settings.system_prompt, '') = ''
        and coalesce(v_settings.additional_prompt, '') = ''
        and coalesce(v_settings.personality, '') = ''
        and v_context_jobs = 0
        and v_stable_memory_candidates = 0
        and v_companion_profile_versions = 0
        and v_memories = 0
        and v_conversation_composer_hints = 0;

    if v_already_reset then
        v_cutoff := v_settings.context_reset_at;
    else
        v_cutoff := clock_timestamp();

        update public.settings as settings
        set context_reset_at = v_cutoff,
            system_prompt = '',
            additional_prompt = '',
            personality = ''
        where settings.id = v_settings.id
          and settings.user_id = p_auth_uid
          and settings.companion_id = p_companion_id
        returning settings.context_reset_at into v_cutoff;
        get diagnostics v_settings_rows_updated = row_count;

        if v_settings_rows_updated <> 1 then
            raise exception 'persona_reset_settings_update_failed';
        end if;
    end if;

    return jsonb_build_object(
        'already_reset', v_already_reset,
        'cutoff', v_cutoff,
        'settings_rows_updated', v_settings_rows_updated,
        'deleted_rows', jsonb_build_object(
            'stable_memory_candidates', v_stable_memory_candidates,
            'companion_profile_versions', v_companion_profile_versions,
            'memories', v_memories,
            'conversation_composer_hints', v_conversation_composer_hints,
            'context_jobs', v_context_jobs,
            'context_jobs_by_type', v_context_jobs_by_type
        )
    );
end;
$$;

revoke all on function public.reset_dengta_persona_memory(uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.reset_dengta_persona_memory(uuid, uuid)
    to service_role;

grant select, update on table public.settings to service_role;
grant select, delete on table public.stable_memory_candidates to service_role;
grant select, delete on table public.companion_profile_versions to service_role;
grant select, delete on table public.memories to service_role;
grant select, delete on table public.conversation_composer_hints to service_role;
grant select, delete on table public.background_jobs to service_role;

comment on function public.reset_dengta_persona_memory(uuid, uuid) is
    'Atomically clears one companion persona and derived memory while preserving chat history and persistent personalization. Service role only.';

notify pgrst, 'reload schema';

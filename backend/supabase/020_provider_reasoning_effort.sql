alter table if exists public.ai_provider_profiles
    add column if not exists reasoning_effort text not null default '';

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'ai_provider_profiles_reasoning_effort_check'
          and conrelid = 'public.ai_provider_profiles'::regclass
    ) then
        alter table public.ai_provider_profiles
            add constraint ai_provider_profiles_reasoning_effort_check
            check (
                reasoning_effort in (
                    '', 'none', 'low', 'medium', 'high', 'xhigh', 'max'
                )
            );
    end if;
end
$$;

comment on column public.ai_provider_profiles.reasoning_effort is
    'Optional OpenAI reasoning effort. Chat profiles are restricted by the service to none because DengTa preserves function tools.';

alter table if exists public.settings
    add column if not exists reasoning_effort text not null default '';

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'settings_reasoning_effort_check'
          and conrelid = 'public.settings'::regclass
    ) then
        alter table public.settings
            add constraint settings_reasoning_effort_check
            check (
                reasoning_effort in (
                    '', 'none', 'low', 'medium', 'high', 'xhigh', 'max'
                )
            );
    end if;
end
$$;

comment on column public.settings.reasoning_effort is
    'Optional reasoning effort for the legacy single-provider configuration. Provider compatibility is validated by the service.';

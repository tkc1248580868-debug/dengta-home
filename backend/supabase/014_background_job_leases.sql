-- DengTa Home 2.0: atomic background-job lease primitives.
--
-- This migration only establishes the database contract used by a future
-- service-role worker. It does not start a worker or schedule any jobs.

create index if not exists background_jobs_tenant_pending_due_idx
    on public.background_jobs (
        user_id,
        companion_id,
        due_at,
        created_at
    )
    where status = 'pending';

create index if not exists background_jobs_tenant_running_lease_idx
    on public.background_jobs (
        user_id,
        companion_id,
        lease_expires_at
    )
    where status = 'running';

create or replace function public.claim_background_jobs(
    p_user_id uuid,
    p_companion_id uuid,
    p_worker_id text,
    p_limit integer default 1,
    p_lease_seconds integer default 300,
    p_max_attempts integer default 5
)
returns setof public.background_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_now timestamptz := clock_timestamp();
    v_worker_id text := btrim(coalesce(p_worker_id, ''));
    v_limit integer := greatest(1, least(coalesce(p_limit, 1), 100));
    v_lease_seconds integer :=
        greatest(30, least(coalesce(p_lease_seconds, 300), 3600));
    v_max_attempts integer :=
        greatest(1, least(coalesce(p_max_attempts, 5), 100));
begin
    if p_user_id is null or p_companion_id is null then
        raise exception 'background_job_tenant_required';
    end if;
    if v_worker_id = '' then
        raise exception 'background_job_worker_required';
    end if;

    -- A worker that disappears cannot call fail_background_job. Once its
    -- final lease expires, close the job instead of leaving it running forever.
    update public.background_jobs as job
    set status = 'failed',
        locked_at = null,
        locked_by = null,
        lease_id = null,
        lease_expires_at = null,
        last_error_code = coalesce(
            nullif(job.last_error_code, ''),
            'max_attempts_exhausted'
        ),
        updated_at = v_now
    where job.user_id = p_user_id
      and job.companion_id = p_companion_id
      and job.attempt_count >= v_max_attempts
      and (
          (
              job.status = 'pending'
              and job.due_at <= v_now
          )
          or (
              job.status = 'running'
              and coalesce(
                  job.lease_expires_at,
                  '-infinity'::timestamptz
              ) <= v_now
          )
      );

    return query
    with candidates as materialized (
        select job.id
        from public.background_jobs as job
        where job.user_id = p_user_id
          and job.companion_id = p_companion_id
          and job.attempt_count < v_max_attempts
          and (
              (
                  job.status = 'pending'
                  and job.due_at <= v_now
              )
              or (
                  job.status = 'running'
                  and coalesce(
                      job.lease_expires_at,
                      '-infinity'::timestamptz
                  ) <= v_now
              )
          )
        order by job.due_at, job.created_at, job.id
        for update skip locked
        limit v_limit
    ),
    claimed as (
        update public.background_jobs as job
        set status = 'running',
            attempt_count = job.attempt_count + 1,
            locked_at = v_now,
            locked_by = v_worker_id,
            lease_id = gen_random_uuid(),
            lease_expires_at =
                v_now + make_interval(secs => v_lease_seconds),
            completed_at = null,
            updated_at = v_now
        from candidates
        where job.id = candidates.id
        returning job.*
    )
    select claimed.*
    from claimed;
end;
$$;

create or replace function public.renew_background_job_lease(
    p_user_id uuid,
    p_companion_id uuid,
    p_job_id uuid,
    p_lease_id uuid,
    p_worker_id text,
    p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_now timestamptz := clock_timestamp();
    v_worker_id text := btrim(coalesce(p_worker_id, ''));
    v_lease_seconds integer :=
        greatest(30, least(coalesce(p_lease_seconds, 300), 3600));
    v_renewed boolean := false;
begin
    if p_user_id is null or p_companion_id is null then
        raise exception 'background_job_tenant_required';
    end if;
    if v_worker_id = '' then
        raise exception 'background_job_worker_required';
    end if;

    update public.background_jobs as job
    set lease_expires_at =
            v_now + make_interval(secs => v_lease_seconds),
        updated_at = v_now
    where job.user_id = p_user_id
      and job.companion_id = p_companion_id
      and job.id = p_job_id
      and job.status = 'running'
      and job.lease_id = p_lease_id
      and job.locked_by = v_worker_id
      and job.lease_expires_at > v_now
    returning true into v_renewed;

    return coalesce(v_renewed, false);
end;
$$;

create or replace function public.complete_background_job(
    p_user_id uuid,
    p_companion_id uuid,
    p_job_id uuid,
    p_lease_id uuid,
    p_worker_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_now timestamptz := clock_timestamp();
    v_worker_id text := btrim(coalesce(p_worker_id, ''));
    v_completed boolean := false;
begin
    if p_user_id is null or p_companion_id is null then
        raise exception 'background_job_tenant_required';
    end if;
    if v_worker_id = '' then
        raise exception 'background_job_worker_required';
    end if;

    update public.background_jobs as job
    set status = 'completed',
        completed_at = v_now,
        locked_at = null,
        locked_by = null,
        lease_id = null,
        lease_expires_at = null,
        updated_at = v_now
    where job.user_id = p_user_id
      and job.companion_id = p_companion_id
      and job.id = p_job_id
      and job.status = 'running'
      and job.lease_id = p_lease_id
      and job.locked_by = v_worker_id
      and job.lease_expires_at > v_now
    returning true into v_completed;

    return coalesce(v_completed, false);
end;
$$;

create or replace function public.fail_background_job(
    p_user_id uuid,
    p_companion_id uuid,
    p_job_id uuid,
    p_lease_id uuid,
    p_worker_id text,
    p_error_code text,
    p_max_attempts integer default 5,
    p_base_retry_seconds integer default 30,
    p_max_retry_seconds integer default 3600
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_now timestamptz := clock_timestamp();
    v_worker_id text := btrim(coalesce(p_worker_id, ''));
    v_error_code text := coalesce(
        nullif(btrim(coalesce(p_error_code, '')), ''),
        'background_job_failed'
    );
    v_max_attempts integer :=
        greatest(1, least(coalesce(p_max_attempts, 5), 100));
    v_base_retry_seconds integer :=
        greatest(1, least(coalesce(p_base_retry_seconds, 30), 86400));
    v_max_retry_seconds integer;
    v_retry_seconds double precision;
    v_job public.background_jobs%rowtype;
begin
    if p_user_id is null or p_companion_id is null then
        raise exception 'background_job_tenant_required';
    end if;
    if v_worker_id = '' then
        raise exception 'background_job_worker_required';
    end if;

    v_max_retry_seconds := greatest(
        v_base_retry_seconds,
        least(coalesce(p_max_retry_seconds, 3600), 604800)
    );

    select job.*
    into v_job
    from public.background_jobs as job
    where job.user_id = p_user_id
      and job.companion_id = p_companion_id
      and job.id = p_job_id
      and job.status = 'running'
      and job.lease_id = p_lease_id
      and job.locked_by = v_worker_id
      and job.lease_expires_at > v_now
    for update;

    if not found then
        return jsonb_build_object('updated', false);
    end if;

    if v_job.attempt_count >= v_max_attempts then
        update public.background_jobs as job
        set status = 'failed',
            locked_at = null,
            locked_by = null,
            lease_id = null,
            lease_expires_at = null,
            last_error_code = v_error_code,
            updated_at = v_now
        where job.id = v_job.id
        returning job.* into v_job;
    else
        v_retry_seconds := least(
            v_max_retry_seconds::double precision,
            v_base_retry_seconds::double precision
                * power(
                    2::double precision,
                    greatest(0, least(v_job.attempt_count - 1, 30))
                )
        );

        update public.background_jobs as job
        set status = 'pending',
            due_at = v_now + make_interval(secs => v_retry_seconds),
            locked_at = null,
            locked_by = null,
            lease_id = null,
            lease_expires_at = null,
            last_error_code = v_error_code,
            updated_at = v_now
        where job.id = v_job.id
        returning job.* into v_job;
    end if;

    return jsonb_build_object(
        'updated', true,
        'status', v_job.status,
        'attempt_count', v_job.attempt_count,
        'retry_at', case
            when v_job.status = 'pending' then to_jsonb(v_job.due_at)
            else null
        end
    );
end;
$$;

revoke all on function public.claim_background_jobs(
    uuid, uuid, text, integer, integer, integer
) from public, anon, authenticated;
revoke all on function public.renew_background_job_lease(
    uuid, uuid, uuid, uuid, text, integer
) from public, anon, authenticated;
revoke all on function public.complete_background_job(
    uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.fail_background_job(
    uuid, uuid, uuid, uuid, text, text, integer, integer, integer
) from public, anon, authenticated;

grant execute on function public.claim_background_jobs(
    uuid, uuid, text, integer, integer, integer
) to service_role;
grant execute on function public.renew_background_job_lease(
    uuid, uuid, uuid, uuid, text, integer
) to service_role;
grant execute on function public.complete_background_job(
    uuid, uuid, uuid, uuid, text
) to service_role;
grant execute on function public.fail_background_job(
    uuid, uuid, uuid, uuid, text, text, integer, integer, integer
) to service_role;

comment on function public.claim_background_jobs(
    uuid, uuid, text, integer, integer, integer
) is
    'Atomically claims due jobs for one user and companion with SKIP LOCKED. Service role only.';
comment on function public.renew_background_job_lease(
    uuid, uuid, uuid, uuid, text, integer
) is
    'Renews one unexpired background-job lease when tenant, worker, and lease token match. Service role only.';
comment on function public.complete_background_job(
    uuid, uuid, uuid, uuid, text
) is
    'Completes one unexpired background-job lease when tenant, worker, and lease token match. Service role only.';
comment on function public.fail_background_job(
    uuid, uuid, uuid, uuid, text, text, integer, integer, integer
) is
    'Fails or reschedules one leased job with bounded exponential backoff. Service role only.';

-- Recurring companion behavior may be re-seeded by chat activity while the
-- current evaluation is running. Allow one running evaluation plus at most
-- one queued successor, but never an unbounded pile of pending duplicates.

create unique index if not exists background_jobs_recurring_pending_uidx
    on public.background_jobs (user_id, companion_id, job_type)
    where status = 'pending'
      and job_type in (
          'proactive_message',
          'moment_post',
          'diary_update',
          'profile_refresh'
      );

comment on index public.background_jobs_recurring_pending_uidx is
    'At most one queued recurring evaluation per user, companion, and task type.';

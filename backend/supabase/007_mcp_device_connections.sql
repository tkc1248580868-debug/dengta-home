create table if not exists public.mcp_connections (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(name) between 1 and 80),
    slug text not null unique check (slug ~ '^[a-z0-9-]{1,48}$'),
    endpoint text not null check (char_length(endpoint) between 8 and 1000),
    auth_type text not null default 'none'
        check (auth_type in ('none', 'bearer', 'custom_header')),
    auth_header text not null default 'Authorization',
    secret_ciphertext text,
    protocol_version text not null default '2025-03-26',
    enabled boolean not null default false,
    discovered_tools jsonb not null default '[]'::jsonb,
    tool_policies jsonb not null default '{}'::jsonb,
    last_status text not null default 'never',
    last_error text,
    last_checked_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.mcp_connections enable row level security;

comment on table public.mcp_connections is
    'Server-only MCP connection metadata. Credentials are AES-GCM encrypted by the backend.';

comment on column public.mcp_connections.secret_ciphertext is
    'Never expose through public APIs or browser-side Supabase clients.';

create table if not exists public.app_knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  app_id text not null,
  title text not null,
  content text not null,
  category text,
  keywords text[] not null default '{}',
  source_name text,
  source_page integer,
  active boolean not null default true,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_by text not null,
  reviewed_by text,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.app_templates (
  id uuid primary key default gen_random_uuid(),
  app_id text not null,
  keyword text not null,
  note text,
  instruction text not null,
  active boolean not null default true,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_by text not null,
  reviewed_by text,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists app_knowledge_entries_app_status_idx
  on public.app_knowledge_entries (app_id, status, updated_at desc);

create index if not exists app_knowledge_entries_keywords_idx
  on public.app_knowledge_entries using gin (keywords);

create index if not exists app_templates_app_status_idx
  on public.app_templates (app_id, status, updated_at desc);

create index if not exists app_templates_keyword_idx
  on public.app_templates (app_id, lower(keyword), updated_at desc);

alter table public.app_knowledge_entries enable row level security;
alter table public.app_templates enable row level security;

comment on table public.app_knowledge_entries is
  'Knowledge per aplikasi. Claim Clarify hanya memakai item approved melalui Edge Function.';

comment on table public.app_templates is
  'Template per aplikasi. Claim Clarify hanya memakai item approved melalui Edge Function.';

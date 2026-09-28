-- My Health Log 初期スキーマ
-- すべてのテーブルは user_id を持ち、RLS で「自分の行だけ」に絞る。
-- API（Vercel Function）はユーザー本人の JWT で Supabase に接続するので、
-- service role キーを持たなくても RLS がそのまま効く。

create extension if not exists pgcrypto;

-- 1日1行の数値（睡眠・体重・ゴルフ）
create table public.daily_logs (
  user_id     uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  date        date        not null,
  sleep_hours numeric(4,2) check (sleep_hours is null or (sleep_hours >= 0 and sleep_hours <= 24)),
  weight_kg   numeric(5,1) check (weight_kg   is null or (weight_kg   >= 20 and weight_kg   <= 300)),
  golf_score  smallint     check (golf_score  is null or (golf_score  >= 18 and golf_score  <= 200)),
  updated_at  timestamptz not null default now(),
  primary key (user_id, date)
);

create table public.meals (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  date       date        not null,
  slot       text        not null check (slot in ('朝食','昼食','夕食','間食')),
  name       text        not null check (char_length(name) between 1 and 80),
  kcal       integer     not null check (kcal between 0 and 5000),
  p          integer     not null default 0 check (p between 0 and 500),
  f          integer     not null default 0 check (f between 0 and 500),
  c          integer     not null default 0 check (c between 0 and 1000),
  from_photo boolean     not null default false,
  photo_path text,
  created_at timestamptz not null default now()
);
create index meals_user_date on public.meals (user_id, date);

create table public.workouts (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  date       date        not null,
  part       text        not null check (part in ('胸','肩','腹筋','二頭','三頭','背中','下半身')),
  name       text        not null check (char_length(name) between 1 and 80),
  -- [{ "w": number, "r": number }]
  sets       jsonb       not null check (jsonb_typeof(sets) = 'array' and jsonb_array_length(sets) between 1 and 30),
  created_at timestamptz not null default now()
);
create index workouts_user_date on public.workouts (user_id, date);

create table public.body_photos (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  date       date        not null,
  photo_path text        not null,
  created_at timestamptz not null default now()
);
create index body_photos_user_date on public.body_photos (user_id, date);

-- チャット履歴（ロードマップ5）
create table public.chat_messages (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  role       text        not null check (role in ('user','assistant')),
  content    text        not null default '',
  image_path text,
  -- assistant の行: 保存した記録の要約 [[kind, text], ...]
  saved      jsonb,
  created_at timestamptz not null default now()
);
create index chat_messages_user_created on public.chat_messages (user_id, created_at desc);

-- ---------- RLS ----------
alter table public.daily_logs    enable row level security;
alter table public.meals         enable row level security;
alter table public.workouts      enable row level security;
alter table public.body_photos   enable row level security;
alter table public.chat_messages enable row level security;

do $$
declare t text;
begin
  foreach t in array array['daily_logs','meals','workouts','body_photos','chat_messages'] loop
    execute format('create policy %I on public.%I for all to authenticated
                    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
                   t || '_own', t);
  end loop;
end $$;

-- anon には一切触らせない
revoke all on public.daily_logs, public.meals, public.workouts, public.body_photos, public.chat_messages from anon;

-- ---------- Storage（写真。非公開バケット） ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- パスは "<user_id>/<YYYY-MM-DD>/<uuid>.jpg"。先頭フォルダが自分の uid のものだけ触れる
create policy photos_own_select on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy photos_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy photos_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 記録に時刻を持たせる
-- 体重は朝と夜で値が変わるので、1 日 1 つ（daily_logs.weight_kg）をやめ、
-- 測った時刻つきで 1 日に何回でも残せる weights テーブルに移す。
-- 食事・トレーニング・身体写真にも時刻（JST の「HH:MM」）を持たせる。
-- 時刻が分からない記録（過去日に時刻なしで送ったもの・移行前のデータ）は null。

create table public.weights (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  date       date        not null,
  time       time(0),
  weight_kg  numeric(5,1) not null check (weight_kg >= 20 and weight_kg <= 300),
  created_at timestamptz not null default now()
);
create index weights_user_date on public.weights (user_id, date);

alter table public.weights enable row level security;
create policy weights_own on public.weights for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.weights from anon;

alter table public.meals       add column time time(0);
alter table public.workouts    add column time time(0);
alter table public.body_photos add column time time(0);

-- 既存の体重を移す。いつ測ったかは残っていないので時刻は null。
-- daily_logs.weight_kg は消さずに残す（このあと新しいコードは読まない。不要になったら別の migration で落とす）。
insert into public.weights (user_id, date, weight_kg, created_at)
select user_id, date, weight_kg, updated_at from public.daily_logs where weight_kg is not null;

-- 既存の食事・トレーニング・身体写真は、記録した日のうちに入力したものだけ、その入力時刻を時刻とみなす。
-- （「昨日の夕食」のように後から入力したものは、入力時刻が実際の時刻ではないので null のまま）
update public.meals set time = (created_at at time zone 'Asia/Tokyo')::time(0)
  where (created_at at time zone 'Asia/Tokyo')::date = date;
update public.workouts set time = (created_at at time zone 'Asia/Tokyo')::time(0)
  where (created_at at time zone 'Asia/Tokyo')::date = date;
update public.body_photos set time = (created_at at time zone 'Asia/Tokyo')::time(0)
  where (created_at at time zone 'Asia/Tokyo')::date = date;

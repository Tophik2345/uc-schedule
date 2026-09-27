create table if not exists uc_private.tests (
 id uuid primary key default gen_random_uuid(), title text not null, description text not null default '',
 minutes int not null check (minutes between 1 and 180), questions jsonb not null,
 status text not null default 'draft' check (status in ('draft','published','closed')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists uc_private.test_attempts (
 id uuid primary key default gen_random_uuid(), test_id uuid not null references uc_private.tests(id),
 user_id uuid not null references auth.users(id), answers jsonb not null default '{}'::jsonb,
 started_at timestamptz not null default now(), ends_at timestamptz not null,
 finished_at timestamptz, reason text, score int,
 unique(test_id,user_id)
);
create index if not exists test_attempts_user_idx on uc_private.test_attempts(user_id);
alter table uc_private.tests enable row level security;
alter table uc_private.test_attempts enable row level security;
revoke all on uc_private.tests, uc_private.test_attempts from public, anon, authenticated;

create or replace function public.uc_test_action(p_actor uuid, p_session uuid, p_action text, p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $func$
declare p uc_private.profiles; t uc_private.tests; a uc_private.test_attempts;
 v_id uuid; v_questions jsonb; v_q jsonb; v_o jsonb; v_answer text; v_score int:=0; v_index int;
 v_now timestamptz:=clock_timestamp(); v_reason text; v_result jsonb;
begin
 select * into p from uc_private.profiles where id=p_actor;
 if p.id is null or p.blocked or p.deleted or p.must_change_password then raise exception 'Доступ закрыт'; end if;
 if not exists(select 1 from auth.sessions where id=p_session and user_id=p_actor) or
 not exists(select 1 from uc_private.sessions where id=p_session and user_id=p_actor and not revoked and expires>v_now)
 then raise exception 'Сеанс завершён. Войдите снова'; end if;
 if p_action='test.list' then
  return jsonb_build_object('owner',p.owner,'tests',coalesce((select jsonb_agg(
   jsonb_build_object('id',x.id,'title',x.title,'description',x.description,'minutes',x.minutes,'status',x.status,
    'questions',case when p.owner then x.questions else null end,
    'attempt', (select jsonb_build_object('id',b.id,'startedAt',b.started_at,'endsAt',b.ends_at,'finishedAt',b.finished_at,'reason',b.reason,'score',b.score) from uc_private.test_attempts b where b.test_id=x.id and b.user_id=p_actor))
   order by x.created_at desc) from uc_private.tests x where p.owner or x.status='published' or exists(select 1 from uc_private.test_attempts b where b.test_id=x.id and b.user_id=p_actor)),'[]'::jsonb));
 end if;
 if p_action='test.save' then
  if not p.owner then raise exception 'Нужны права хозяина'; end if;
  if length(trim(coalesce(p_input->>'title',''))) not between 1 and 160 or length(coalesce(p_input->>'description',''))>2000
   or coalesce(p_input->>'minutes','') !~ '^\d{1,3}$' or (p_input->>'minutes')::int not between 1 and 180 then raise exception 'Проверьте название и время'; end if;
  v_questions=p_input->'questions';
  if jsonb_typeof(v_questions)<>'array' or jsonb_array_length(v_questions) not between 1 and 100 then raise exception 'Добавьте вопросы (от 1 до 100)'; end if;
  for v_q in select value from jsonb_array_elements(v_questions) loop
   if jsonb_typeof(v_q)<>'object' or length(trim(coalesce(v_q->>'text',''))) not between 1 and 1000
    or jsonb_typeof(v_q->'options')<>'array' or jsonb_array_length(v_q->'options') not between 2 and 8
    or coalesce(v_q->>'correct','') !~ '^\d$' or (v_q->>'correct')::int >= jsonb_array_length(v_q->'options') then raise exception 'Проверьте вопросы и варианты'; end if;
   for v_o in select value from jsonb_array_elements(v_q->'options') loop
    if jsonb_typeof(v_o)<>'string' or length(trim(v_o #>> '{}')) not between 1 and 500 then raise exception 'Заполните варианты ответа'; end if;
   end loop;
  end loop;
  if nullif(p_input->>'id','') is null then
   insert into uc_private.tests(title,description,minutes,questions) values(trim(p_input->>'title'),coalesce(p_input->>'description',''),(p_input->>'minutes')::int,v_questions) returning * into t;
  else
   v_id=(p_input->>'id')::uuid;
   select * into t from uc_private.tests where id=v_id for update;
   if t.id is null or t.status<>'draft' or exists(select 1 from uc_private.test_attempts where test_id=v_id) then raise exception 'Редактировать можно только черновик без попыток'; end if;
   update uc_private.tests set title=trim(p_input->>'title'),description=coalesce(p_input->>'description',''),minutes=(p_input->>'minutes')::int,questions=v_questions,updated_at=v_now where id=v_id returning * into t;
  end if;
  return jsonb_build_object('id',t.id);
 end if;
 if p_action in ('test.publish','test.close') then
  if not p.owner then raise exception 'Нужны права хозяина'; end if;
  update uc_private.tests set status=case when p_action='test.publish' then 'published' else 'closed' end,updated_at=v_now
   where id=(p_input->>'id')::uuid and (p_action='test.close' or status='draft') returning * into t;
  if t.id is null then raise exception 'Тест не найден или уже опубликован'; end if;
  return jsonb_build_object('ok',true);
 end if;
 if p_action='test.results' then
  if not p.owner then raise exception 'Нужны права хозяина'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'login',u.login,'name',u.first||' '||u.last,'answers',b.answers,
   'startedAt',b.started_at,'endsAt',b.ends_at,'finishedAt',b.finished_at,'reason',b.reason,'score',b.score) order by b.started_at desc)
   from uc_private.test_attempts b join uc_private.profiles u on u.id=b.user_id where b.test_id=(p_input->>'id')::uuid),'[]'::jsonb);
 end if;
 v_id=(p_input->>'id')::uuid;
 select * into t from uc_private.tests where id=v_id;
 if t.id is null then raise exception 'Тест не найден'; end if;
 if p_action='test.start' then
  if t.status<>'published' then raise exception 'Тест закрыт'; end if;
  insert into uc_private.test_attempts(test_id,user_id,ends_at) values(v_id,p_actor,v_now+make_interval(mins=>t.minutes))
   on conflict(test_id,user_id) do nothing;
 end if;
 select * into a from uc_private.test_attempts where test_id=v_id and user_id=p_actor for update;
 if a.id is null then raise exception 'Сначала начните тест'; end if;
 if a.finished_at is null and v_now>=a.ends_at then
  update uc_private.test_attempts set finished_at=v_now,reason='Время истекло' where id=a.id;
  a.finished_at=v_now; a.reason='Время истекло';
 end if;
 if p_action='test.answer' then
  if a.finished_at is not null then raise exception 'Попытка завершена'; end if;
  if coalesce(p_input->>'index','') !~ '^\d{1,3}$' or (p_input->>'index')::int>=jsonb_array_length(t.questions)
   or coalesce(p_input->>'option','') !~ '^\d$' then raise exception 'Неверный ответ'; end if;
  v_index=(p_input->>'index')::int;
  v_q=t.questions->v_index;
  if (p_input->>'option')::int>=jsonb_array_length(v_q->'options') then raise exception 'Неверный вариант'; end if;
  update uc_private.test_attempts set answers=jsonb_set(answers,array[v_index::text],to_jsonb((p_input->>'option')::int),true) where id=a.id returning * into a;
 end if;
 if p_action='test.finish' and a.finished_at is null then
  if jsonb_typeof(p_input->'answers')='object' then
   for v_answer,v_o in select key,value from jsonb_each(p_input->'answers') loop
    if v_answer !~ '^\d{1,3}$' or v_answer::int>=jsonb_array_length(t.questions)
      or jsonb_typeof(v_o)<>'number' or v_o::text !~ '^\d$'
      or (v_o::text)::int>=jsonb_array_length(t.questions->(v_answer::int)->'options') then
      raise exception 'Неверный ответ';
    end if;
    a.answers=jsonb_set(a.answers,array[v_answer],v_o,true);
   end loop;
  end if;
  v_reason=case when p_input->>'reason'='blur' then 'Переключение вкладки' else 'Отправлено' end;
  update uc_private.test_attempts set answers=a.answers,finished_at=v_now,reason=v_reason where id=a.id returning * into a;
 end if;
 if a.finished_at is not null and a.score is null then
  for v_index in 0..jsonb_array_length(t.questions)-1 loop
   if a.answers->>v_index::text=t.questions->v_index->>'correct' then v_score=v_score+1; end if;
  end loop;
  update uc_private.test_attempts set score=v_score where id=a.id returning * into a;
 end if;
 if p_action not in ('test.start','test.view','test.answer','test.finish') then raise exception 'Неизвестное действие'; end if;
 return jsonb_build_object('id',t.id,'title',t.title,'description',t.description,'minutes',t.minutes,
  'questions',(select jsonb_agg(q.value - 'correct' order by q.ordinality) from jsonb_array_elements(t.questions) with ordinality q),
  'correct',case when a.finished_at is not null then (select jsonb_agg((q.value->>'correct')::int order by q.ordinality) from jsonb_array_elements(t.questions) with ordinality q) else null end,
  'answers',a.answers,'startedAt',a.started_at,'endsAt',a.ends_at,'finishedAt',a.finished_at,'reason',a.reason,'score',a.score);
end $func$;
revoke all on function public.uc_test_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.uc_test_action(uuid,uuid,text,jsonb) to service_role;

create or replace function public.uc_bootstrap_claim(p_id uuid,p_login text,p_first text,p_last text,p_code text)
returns boolean language plpgsql security definer set search_path='' as $func$
begin
 perform pg_advisory_xact_lock(78123659);
 if exists(select 1 from uc_private.profiles) or
  not exists(select 1 from uc_private.settings where key='test_bootstrap_hash' and value=encode(extensions.digest(p_code,'sha256'),'hex'))
 then raise exception 'Код настройки неверен или владелец уже создан'; end if;
 insert into uc_private.profiles(id,login,first,last,owner,must_change_password)
 values(p_id,p_login,p_first,p_last,true,false);
 delete from uc_private.settings where key='test_bootstrap_hash';
 return true;
end $func$;
revoke all on function public.uc_bootstrap_claim(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.uc_bootstrap_claim(uuid,text,text,text,text) to service_role;

create or replace function public.uc_bootstrap_ready() returns boolean language sql stable security definer set search_path='' as $func$
 select not exists(select 1 from uc_private.profiles) and exists(select 1 from uc_private.settings where key='test_bootstrap_hash');
$func$;
create or replace function public.uc_bootstrap_allowed(p_code text) returns boolean language sql stable security definer set search_path='' as $func$
 select not exists(select 1 from uc_private.profiles) and exists(select 1 from uc_private.settings where key='test_bootstrap_hash' and value=encode(extensions.digest(p_code,'sha256'),'hex'));
$func$;
revoke all on function public.uc_bootstrap_ready(), public.uc_bootstrap_allowed(text) from public,anon,authenticated;
grant execute on function public.uc_bootstrap_ready(), public.uc_bootstrap_allowed(text) to service_role;

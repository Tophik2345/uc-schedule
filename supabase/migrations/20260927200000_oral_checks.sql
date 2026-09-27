alter table uc_private.profiles add column if not exists test_interviewer boolean not null default false;
create table if not exists uc_private.oral_templates (
 category text primary key, label text not null, min_count int not null, max_count int not null,
 questions jsonb not null default '[]'::jsonb,
 check (min_count>0 and max_count>=min_count and max_count<=100)
);
insert into uc_private.oral_templates(category,label,min_count,max_count) values
 ('entry','Вступление в отдел / стажировка',15,20),
 ('instructor','Инструктор',30,40),
 ('deputy','Замнач обзвона',40,50)
on conflict(category) do nothing;
create table if not exists uc_private.oral_interviews (
 id uuid primary key default gen_random_uuid(), candidate text not null, category text not null references uc_private.oral_templates(category),
 total int not null, questions jsonb not null, marks jsonb not null, interviewer uuid not null references uc_private.profiles(id),
 started_at timestamptz not null default now(), completed_at timestamptz
);
create index if not exists oral_interviews_interviewer_idx on uc_private.oral_interviews(interviewer,started_at desc);
alter table uc_private.oral_templates enable row level security;
alter table uc_private.oral_interviews enable row level security;
revoke all on uc_private.oral_templates,uc_private.oral_interviews from public,anon,authenticated;

create or replace function public.uc_oral_action(p_actor uuid,p_session uuid,p_action text,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $func$
declare p uc_private.profiles; t uc_private.oral_templates; v uc_private.oral_interviews;
 v_id uuid; v_index int; v_total int; v_questions jsonb; v_marks jsonb; v_text text; v_mark boolean; v_count int;
begin
 select * into p from uc_private.profiles where id=p_actor;
 if p.id is null or p.blocked or p.deleted or p.must_change_password then raise exception 'Доступ закрыт'; end if;
 if not exists(select 1 from auth.sessions where id=p_session and user_id=p_actor) or
 not exists(select 1 from uc_private.sessions where id=p_session and user_id=p_actor and not revoked and expires>clock_timestamp())
 then raise exception 'Сеанс завершён. Войдите снова'; end if;
 if not (p.owner or p.test_interviewer) then raise exception 'Доступ только для замнача'; end if;
 if p_action='oral.list' then
  return jsonb_build_object('owner',p.owner,'templates',coalesce((select jsonb_agg(to_jsonb(x) order by x.min_count) from uc_private.oral_templates x),'[]'::jsonb),
   'interviews',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'candidate',x.candidate,'category',x.category,'total',x.total,
    'score',(select count(*) from jsonb_array_elements(x.marks) m where m.value='true'::jsonb),
    'startedAt',x.started_at,'completedAt',x.completed_at,'interviewer',u.first||' '||u.last)
    order by x.started_at desc) from uc_private.oral_interviews x join uc_private.profiles u on u.id=x.interviewer where p.owner or x.interviewer=p_actor),'[]'::jsonb));
 end if;
 if p_action='oral.staff' then
  if not p.owner then raise exception 'Нужны права владельца'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'login',x.login,'name',x.first||' '||x.last,'interviewer',x.test_interviewer) order by x.login)
   from uc_private.profiles x where not x.deleted and not x.owner),'[]'::jsonb);
 end if;
 if p_action='oral.staff.set' then
  if not p.owner then raise exception 'Нужны права владельца'; end if;
  update uc_private.profiles set test_interviewer=coalesce((p_input->>'value')::boolean,false)
   where id=(p_input->>'id')::uuid and not owner and not deleted;
  if not found then raise exception 'Аккаунт не найден'; end if;
  return '{"ok":true}'::jsonb;
 end if;
 if p_action='oral.template.save' then
  if not p.owner then raise exception 'Нужны права владельца'; end if;
  select * into t from uc_private.oral_templates where category=p_input->>'category' for update;
  if t.category is null then raise exception 'Категория не найдена'; end if;
  v_questions=p_input->'questions';
  if jsonb_typeof(v_questions)<>'array' or jsonb_array_length(v_questions)>t.max_count then raise exception 'Неверное количество вопросов'; end if;
  for v_text in select jsonb_array_elements_text(v_questions) loop
   if length(v_text)>1000 then raise exception 'Вопрос слишком длинный'; end if;
  end loop;
  update uc_private.oral_templates set questions=v_questions where category=t.category;
  return '{"ok":true}'::jsonb;
 end if;
 if p_action='oral.start' then
  select * into t from uc_private.oral_templates where category=p_input->>'category';
  if t.category is null or coalesce(p_input->>'total','') !~ '^\d{1,2}$' then raise exception 'Проверьте категорию и число вопросов'; end if;
  v_total=(p_input->>'total')::int;
  if v_total not between t.min_count and t.max_count or length(trim(coalesce(p_input->>'candidate',''))) not between 2 and 120 then raise exception 'Проверьте имя и число вопросов'; end if;
  v_questions='[]'::jsonb;v_marks='[]'::jsonb;
  for v_index in 0..v_total-1 loop
   v_questions=v_questions||jsonb_build_array(coalesce(nullif(trim(t.questions->>v_index),''),'Вопрос '||(v_index+1)::text));
   v_marks=v_marks||' [null]'::jsonb;
  end loop;
  insert into uc_private.oral_interviews(candidate,category,total,questions,marks,interviewer)
   values(trim(p_input->>'candidate'),t.category,v_total,v_questions,v_marks,p_actor) returning * into v;
  return to_jsonb(v);
 end if;
 if p_action not in ('oral.view','oral.mark','oral.finish') then raise exception 'Неизвестное действие'; end if;
 v_id=(p_input->>'id')::uuid;
 select * into v from uc_private.oral_interviews where id=v_id and (p.owner or interviewer=p_actor) for update;
 if v.id is null then raise exception 'Опрос не найден'; end if;
 if p_action='oral.mark' then
  if v.completed_at is not null then raise exception 'Опрос уже завершён'; end if;
  if coalesce(p_input->>'index','') !~ '^\d{1,2}$' then raise exception 'Номер вопроса неверен'; end if;
  v_index=(p_input->>'index')::int;
  if v_index>=v.total or jsonb_typeof(p_input->'mark')<>'boolean' then raise exception 'Проверьте отметку'; end if;
  v_text=trim(coalesce(p_input->>'text',''));
  if length(v_text) not between 1 and 1000 then raise exception 'Введите вопрос'; end if;
  update uc_private.oral_interviews set questions=jsonb_set(questions,array[v_index::text],to_jsonb(v_text)),
   marks=jsonb_set(marks,array[v_index::text],p_input->'mark') where id=v.id returning * into v;
 end if;
 if p_action='oral.finish' and v.completed_at is null then
  if exists(select 1 from jsonb_array_elements(v.marks) m where m.value='null'::jsonb) then raise exception 'Отметьте каждый ответ галочкой или крестиком'; end if;
  update uc_private.oral_interviews set completed_at=clock_timestamp() where id=v.id returning * into v;
 end if;
 return to_jsonb(v)||jsonb_build_object('score',(select count(*) from jsonb_array_elements(v.marks) m where m.value='true'::jsonb));
end $func$;
revoke all on function public.uc_oral_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.uc_oral_action(uuid,uuid,text,jsonb) to service_role;

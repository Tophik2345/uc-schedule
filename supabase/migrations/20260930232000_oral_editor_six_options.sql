-- Keep the existing password hash; disable password changes and allow up to six options per question.
create or replace function public.uc_oral_editor(p_action text, p_password text default '', p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $func$
declare v_hash text; v_category text; v_label text; v_questions jsonb; v_answers jsonb; v_explanations jsonb; v_options jsonb; v_item jsonb; v_option jsonb; v_count int;
begin
 if p_action='demo' then
  return coalesce((select jsonb_agg(jsonb_build_object('category',t.category,'label',t.label,'questions',t.questions,'answers',t.answers,'explanations',t.explanations,'options',t.options) order by t.category) from uc_private.oral_templates t),'[]'::jsonb);
 end if;
 select value into v_hash from uc_private.settings where key='oral_editor_hash';
 if v_hash is null or length(coalesce(p_password,''))>200 or extensions.crypt(coalesce(p_password,''),v_hash)<>v_hash then raise exception 'Неверный специальный пароль'; end if;
 if p_action='load' then
  return coalesce((select jsonb_agg(to_jsonb(t) order by t.category) from uc_private.oral_templates t),'[]'::jsonb);
 end if;
 if p_action<>'save' then raise exception 'Неизвестное действие'; end if;
 v_category=p_input->>'category';v_label=trim(coalesce(p_input->>'label',''));
 if v_category not in ('entry','instructor','deputy') or length(v_label) not between 1 and 100 then raise exception 'Проверьте название экзамена'; end if;
 v_questions=p_input->'questions';v_answers=p_input->'answers';v_explanations=p_input->'explanations';v_options=p_input->'options';
 if jsonb_typeof(v_questions)<>'array' or jsonb_typeof(v_answers)<>'array' or jsonb_typeof(v_explanations)<>'array' or jsonb_typeof(v_options)<>'array' then raise exception 'Проверьте вопросы'; end if;
 v_count=jsonb_array_length(v_questions);
 if v_count not between 1 and 100 or jsonb_array_length(v_answers)<>v_count or jsonb_array_length(v_explanations)<>v_count or jsonb_array_length(v_options)<>v_count then raise exception 'Добавьте от 1 до 100 вопросов'; end if;
 for v_item in select value from jsonb_array_elements(v_questions) loop
  if jsonb_typeof(v_item)<>'string' or length(trim(v_item #>> '{}')) not between 1 and 1000 then raise exception 'Заполните текст каждого вопроса'; end if;
 end loop;
 for v_item in select value from jsonb_array_elements(v_answers) loop
  if jsonb_typeof(v_item)<>'string' or length(v_item #>> '{}')>1000 then raise exception 'Ожидаемый ответ слишком длинный'; end if;
 end loop;
 for v_item in select value from jsonb_array_elements(v_explanations) loop
  if jsonb_typeof(v_item)<>'string' or length(v_item #>> '{}')>2000 then raise exception 'Пояснение слишком длинное'; end if;
 end loop;
 for v_item in select value from jsonb_array_elements(v_options) loop
  if jsonb_typeof(v_item)<>'array' or jsonb_array_length(v_item)>6 then raise exception 'Не более 6 вариантов на вопрос'; end if;
  for v_option in select value from jsonb_array_elements(v_item) loop
   if jsonb_typeof(v_option)<>'string' or length(trim(v_option #>> '{}')) not between 1 and 500 then raise exception 'Заполните варианты'; end if;
  end loop;
 end loop;
 update uc_private.oral_templates set label=v_label,questions=v_questions,answers=v_answers,explanations=v_explanations,options=v_options,min_count=1,max_count=v_count where category=v_category;
 if not found then raise exception 'Раздел не найден'; end if;
 return '{"ok":true}'::jsonb;
end $func$;
revoke all on function public.uc_oral_editor(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.uc_oral_editor(text,text,jsonb) to service_role;

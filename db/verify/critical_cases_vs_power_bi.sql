-- Critical cases vs. the original Power BI report (npm run db:sql -- db/verify/critical_cases_vs_power_bi.sql).
-- Expected: 100 critical cases (report header) and the same "Critical Cases" X marks
-- for the 16 vehicles visible in the report's Overview screenshot. Runs as owner (all depots).
select count(*) filter (where is_critical)::int as critical_cases, 100 as power_bi_critical_cases
from public.vehicle_conditions(app.as_of());

with power_bi (vehicle_id, power_bi_critical) as (values
  (946, false), (22, true), (484, true), (836, true), (637, true), (452, true), (259, false), (684, true),
  (789, true), (890, false), (843, false), (918, false), (130, true), (14, true), (375, true), (688, true))
select p.vehicle_id, p.power_bi_critical, c.is_critical as app_critical,
       c.cond1_episodes, c.cond2_days, c.frc_active,
       case when p.power_bi_critical = c.is_critical then 'match' else 'DIFFERENT' end as result
from power_bi p join public.vehicle_conditions(app.as_of()) c using (vehicle_id)
order by result, p.vehicle_id;

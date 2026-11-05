# Metrics and business rules

The semantic layer lives in PostgreSQL (`db/migrations/20261105090000_semantic_layer.sql`).
Dashboard, assistant and exports read only from these objects, so they can never disagree.
Everything is `SECURITY INVOKER`: row level security limits results to what the user may see.

| Object | Grain | Used for |
|---|---|---|
| `v_downtime_events` | One row per episode, with vehicle attributes | Episode tables, vehicle page timeline |
| `v_vehicle_status` | One row per vehicle (last 12 months) | Dashboard list, vehicle page, rankings, critical cases |
| `v_fleet_kpis` | One row | Dashboard header KPIs |
| `downtime_metrics(from, to, group_by, filters…)` | One row per group (and month) | Trends and breakdowns for any period |
| `vehicle_conditions(as_of)` | One row per vehicle | Critical-case rules at any date (verification) |

## Dates and windows

- **Reference date (`as_of`):** today in Europe/Berlin (`app.as_of()`).
- **Analysis window (12 months):** the 365 days ending today, `[as_of − 364, as_of]`. An episode is in the window if it starts or ends inside it (it overlaps the window).
- **Last 6 months:** the 180 days ending today, `[as_of − 179, as_of]` (the DAX uses `TODAY() − 180`).
- **Data recency:** the source export ends about two months before the report's reference date, so the most recent months show little downtime. That is the data, not a calculation error.

## Metrics

| Metric | Definition |
|---|---|
| **Downtime days** | Calendar days a vehicle was down, inclusive (`end − start + 1`). For a period, each episode counts only its days inside the period (an episode from 20 Jan to 10 Feb adds 12 days to January and 10 to February). |
| **Episodes** | Downtime episodes that overlap the period. An episode spanning two months counts in both months. |
| **MTTR (mean time to repair)** | Downtime days ÷ episodes, in days per episode. |
| **Days between episodes** | For each episode, days from the end of the previous episode of the same vehicle to its start (`start − previous end − 1`); averaged over the episodes in the window. |
| **Availability** | `1 − downtime days ÷ (vehicles × days in the period)`, as a percentage. Vehicles = all visible vehicles that match the filters (not only those with downtime). Not defined per downtime category. |
| **Monthly trend** | `downtime_metrics(…, group_by => 'month')`: the metrics above per calendar month. |
| **Vehicle ranking** | `v_vehicle_status` ordered by downtime days, episodes or MTTR; or `downtime_metrics(…, group_by => 'vehicle')` for any period. |
| **Breakdowns** | `group_by`: `organization` (depot), `vehicle_type` (35 types), `vehicle_class` (Trailer / Truck / Van), `category` (4 downtime categories), `vehicle`, `month`, or `none`. |
| **Critical rate** | Critical cases ÷ fleet vehicles × 100 (critical cases per 100 vehicles), last 12 months. Compares depots or vehicle types of different size. In `fleet_summary`. |
| **Active FRC** | Status "Review Case Active – Standard" or "Review Case Active – Individual" (`fleet_review_cases.is_active`). |

## Critical cases (a Fleet Review Case should be opened)

Translated from the Power BI measures (`Condition 1`, `Condition 2`).

**Counted episodes:** episodes that start in the last 6 months **and** after the end of the vehicle's last FRC (all of them if it never had one).

| Rule | Definition | Column |
|---|---|---|
| Condition 1 | No active FRC and ≥ 3 counted episodes | `condition_1`, `cond1_episodes` |
| Condition 2 | No active FRC and ≥ 20 downtime days in counted episodes (full episode length) | `condition_2`, `cond2_days` |
| Condition 3 | No active FRC and > 20 downtime days in the last 12 months (all episodes, days inside the window) | `condition_3`, `cond3_days` |
| **Critical case** | **Condition 1 or Condition 2** | `is_critical` |

### Why Condition 3 is not part of `is_critical`

The "Business Rules" page of the report lists three rules, but the report's "Critical Cases" column implements only Conditions 1 and 2. Evidence: vehicle 946 has no FRC and 121 downtime days, which meets Condition 3, but the report does not mark it. Applying Condition 3 as written would add about 214 vehicles. It is computed and shown separately (`condition_3`) so the decision can be revisited without changing the data.

### Verification against the Power BI report

`db/verify/critical_cases_vs_power_bi.sql`:
- **100 critical cases**, the same number as the report header.
- **16 of 16** vehicles visible in the report's Overview page get the same "Critical Cases" mark.

The match holds with the report evaluated on 2026-07-22 (its `TODAY()`), two weeks after its "Last Update" of 2026-07-08, in line with the two-week refresh cycle. The import shifts dates so that this day is today ([DATA_MODEL.md](DATA_MODEL.md)).

## Differences from the Power BI report (on purpose)

- **Days per episode:** inclusive calendar days from the dates. The report's detail view already showed same-day episodes as 1 day; the Excel `Days` column sometimes says 0 (kept as `days_source`).
- **12-month window is applied by the database.** The report's Excel was already an extract of roughly the last 12–15 months, so its Episodes and Days columns covered all rows. Here the window is always the last 365 days, so a few older episodes drop out of the 12-month figures.
- **Downtime days in a period are clipped to the period** (an ongoing episode does not add future days). Condition 2 keeps the report's logic: full length of the counted episodes.

## Permissions (row level security)

| Role | Sees |
|---|---|
| `fleet_ops` | All depots |
| `depot_supervisor` | Only vehicles of their depot, and the episodes and review cases of those vehicles |
| No user / unknown user | Nothing |

The app connects as `app_login` (member of `app_reader`): `SELECT` and `EXECUTE` only, no writes. Each request sets the verified user id with `set_config('app.user_id', …, true)` inside its transaction; policies read the user's role and depot from `app_users`.
Verification: `db/verify/rls_by_role.sql` and `db/verify/app_role_read_only.sql` (run with `--app`).

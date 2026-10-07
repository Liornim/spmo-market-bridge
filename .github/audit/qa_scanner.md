# Opportunity Scanner — independent QA (qa_recompute.mjs)

Run: 2026-10-07T05:37:16.425Z  scan_time: 2026-10-07T05:36:44.000Z  rows: 129  candidates: 27  (24.0s)

## Checks

| check | pass | fail | skip |
|---|---:|---:|---:|
| files_present | 3 | 0 | 0 |
| csv_field_count | 156 | 0 | 0 |
| header_matches_spec | 2 | 0 | 0 |
| one_row_per_symbol | 129 | 0 | 0 |
| symbol_not_blank | 129 | 0 | 0 |
| short_status_enum | 129 | 0 | 0 |
| long_status_enum | 129 | 0 | 0 |
| data_quality_enum | 129 | 0 | 0 |
| falling_risk_enum | 129 | 0 | 0 |
| score_range_0_100 | 258 | 0 | 0 |
| no_zero_for_missing | 836 | 0 | 0 |
| non_ready_has_why_not_ready | 125 | 0 | 0 |
| short_plan_all_or_nothing | 129 | 0 | 0 |
| nonbuy_rows_buy_blank | 226 | 0 | 0 |
| core_fields_present | 903 | 0 | 0 |
| buy_rows_fields_present | 96 | 0 | 0 |
| ready_armed_plan_present | 144 | 0 | 0 |
| ready_why_not_ready_blank | 4 | 0 | 0 |
| avoid_rows_plan_blank | 192 | 0 | 0 |
| rank_permutation | 2 | 0 | 0 |
| candidates_filter | 27 | 0 | 0 |
| candidates_unique | 27 | 0 | 0 |
| candidates_rows_equal_all | 27 | 0 | 0 |
| candidates_complete | 27 | 0 | 0 |
| candidates_sort_order | 26 | 0 | 0 |
| summary_counts | 8 | 0 | 0 |
| summary_top5 | 2 | 0 | 0 |
| scan_time_consistent | 129 | 0 | 0 |
| json_rows_count | 1 | 0 | 0 |
| json_rows_match_csv | 129 | 0 | 0 |
| lt_target_pct | 133 | 0 | 0 |
| lt_target_above_base | 133 | 0 | 0 |
| lt_drawdown_internal | 129 | 0 | 0 |
| lt_distance_low_internal | 129 | 0 | 0 |
| lt_low_le_cur_le_high | 129 | 0 | 0 |
| lt_percentile_range | 129 | 0 | 0 |
| lt_action_status_agree | 16 | 0 | 0 |
| lt_buy_lower_below_current | 7 | 0 | 0 |
| lt_action_eq_buy_price | 16 | 0 | 0 |
| lt_invalidation_below_buy | 16 | 0 | 0 |
| lt_t2_gt_t1 | 52 | 0 | 0 |
| lt_buy_now_eq_current | 9 | 0 | 0 |
| st_entry_action_text | 12 | 0 | 0 |
| st_stop_below_entry | 12 | 0 | 0 |
| st_risk_eq_entry_minus_stop | 12 | 0 | 0 |
| st_rr1 | 12 | 0 | 0 |
| st_rr2 | 12 | 0 | 0 |
| st_t1_at_least_1R | 12 | 0 | 0 |
| st_t2_ge_t1 | 12 | 0 | 0 |
| st_target_pct | 24 | 0 | 0 |
| st_exit_text_numbers | 12 | 0 | 0 |
| st_cancel_text_numbers | 12 | 0 | 0 |
| ready_rr2_ge_1_5 | 4 | 0 | 0 |
| ready_rr2_ge_1_5_from_prices | 4 | 0 | 0 |
| recompute_has_data | 25 | 0 | 0 |
| rc_last_bar_time | 25 | 0 | 0 |
| rc_current_price | 25 | 0 | 0 |
| rc_history_start | 25 | 0 | 0 |
| rc_history_end | 25 | 0 | 0 |
| rc_history_days | 25 | 0 | 0 |
| rc_period_high | 25 | 0 | 0 |
| rc_period_low | 25 | 0 | 0 |
| rc_price_percentile | 25 | 0 | 0 |
| rc_drawdown_from_high_pct | 25 | 0 | 0 |
| rc_distance_from_low_pct | 25 | 0 | 0 |

## Failures (0)

none

## Notes

- CSV has 16 AVOID rows but summary has no short_avoid key
- PART C sample: 25 symbols (20 READY/BUY NOW/BUY LOWER, all included even if > 25; 5 seeded-random others, seed 20261007); cutoff = bars with unix+60 <= scan_time 2026-10-07T05:36:44.000Z.
- ABNB: archive 10140 + main 2730 rows (2730 overlapping minutes, main wins) -> 26 sessions, last 2026-10-06 15:59 @ 160.42
- AMGN: archive 10528 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 402.73
- AMD: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 649.55
- ADBE: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 238.13
- BMY: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 59.58
- ANET: archive 10528 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 215.36
- COP: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 129.36
- FISV: archive 10140 + main 2730 rows (2730 overlapping minutes, main wins) -> 26 sessions, last 2026-10-06 15:59 @ 45.47
- CSCO: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 117.97
- GE: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 309.37
- HOOD: archive 10140 + main 2730 rows (2730 overlapping minutes, main wins) -> 26 sessions, last 2026-10-06 15:59 @ 112.01
- INTU: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 289.71
- NEE: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 77.88
- SPGI: archive 10526 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 396.07
- MCD: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 232.42
- TMUS: archive 10527 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 165.94
- UNH: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 376.12
- UNP: archive 10515 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 276.62
- WFC: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 81.52
- XLY: archive 11305 + main 2730 rows (2730 overlapping minutes, main wins) -> 29 sessions, last 2026-10-06 15:59 @ 111.74
- NVDA: archive 11310 + main 2730 rows (2730 overlapping minutes, main wins) -> 29 sessions, last 2026-10-06 15:59 @ 239.17
- PANW: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 419.95
- PM: archive 10527 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 190.4
- AMZN: archive 11310 + main 2730 rows (2730 overlapping minutes, main wins) -> 29 sessions, last 2026-10-06 15:59 @ 256.33
- ABBV: archive 10528 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 266.79

QA_RECOMPUTE: PASS

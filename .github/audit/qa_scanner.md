# Opportunity Scanner — independent QA (qa_recompute.mjs)

Run: 2026-10-07T05:24:48.382Z  scan_time: 2026-10-07T05:24:10.000Z  rows: 129  candidates: 27  (30.3s)

## Checks

| check | pass | fail | skip |
|---|---:|---:|---:|
| files_present | 3 | 0 | 0 |
| csv_field_count | 156 | 0 | 0 |
| header_matches_spec | 2 | 0 | 0 |
| one_row_per_symbol | 129 | 0 | 0 |
| symbol_not_blank | 129 | 0 | 0 |
| short_status_enum | 116 | 13 | 0 |
| long_status_enum | 129 | 0 | 0 |
| data_quality_enum | 129 | 0 | 0 |
| falling_risk_enum | 129 | 0 | 0 |
| score_range_0_100 | 258 | 0 | 0 |
| no_zero_for_missing | 856 | 0 | 0 |
| non_ready_has_why_not_ready | 124 | 0 | 0 |
| short_plan_all_or_nothing | 116 | 13 | 0 |
| nonbuy_rows_buy_blank | 226 | 0 | 0 |
| core_fields_present | 903 | 0 | 0 |
| buy_rows_fields_present | 96 | 0 | 0 |
| ready_armed_plan_present | 144 | 0 | 0 |
| ready_why_not_ready_blank | 5 | 0 | 0 |
| avoid_rows_plan_blank | 84 | 0 | 0 |
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
| lt_target_pct | 153 | 0 | 0 |
| lt_target_above_base | 150 | 3 | 0 |
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
| st_cancel_text_numbers | 0 | 12 | 0 |
| ready_rr2_ge_1_5 | 5 | 0 | 0 |
| ready_rr2_ge_1_5_from_prices | 5 | 0 | 0 |
| recompute_has_data | 25 | 0 | 0 |
| rc_last_bar_time | 25 | 0 | 0 |
| rc_current_price | 25 | 0 | 0 |
| rc_history_start | 25 | 0 | 0 |
| rc_history_end | 25 | 0 | 0 |
| rc_history_days | 25 | 0 | 0 |
| rc_period_high | 25 | 0 | 0 |
| rc_period_low | 25 | 0 | 0 |
| rc_price_percentile | 23 | 2 | 0 |
| rc_drawdown_from_high_pct | 25 | 0 | 0 |
| rc_distance_from_low_pct | 25 | 0 | 0 |

## Failures (43)

- [short_status_enum] ADBE: short_term_status='FAILED_SETUP' not in READY/ARMED/WATCH/AVOID
- [short_status_enum] CRM: short_term_status='FAILED_SETUP' not in READY/ARMED/WATCH/AVOID
- [short_status_enum] FISV: short_term_status='FAILED_SETUP' not in READY/ARMED/WATCH/AVOID
- [short_status_enum] ICE: short_term_status='FAILED_SETUP' not in READY/ARMED/WATCH/AVOID
- [short_status_enum] KKR: short_term_status='FAILED_SETUP' not in READY/ARMED/WATCH/AVOID
- [short_status_enum] KLAC: short_term_status='FAILED_SETUP' not in READY/ARMED/WATCH/AVOID
- [short_status_enum] MDT: short_term_status='FAILED_SETUP' not in READY/ARMED/WATCH/AVOID
- [short_status_enum] MSTR: short_term_status='FAILED_SETUP' not in READY/ARMED/WATCH/AVOID
- [short_status_enum] PM: short_term_status='FAILED_SETUP' not in READY/ARMED/WATCH/AVOID
- [short_status_enum] SCHW: short_term_status='FAILED_SETUP' not in READY/ARMED/WATCH/AVOID
- [short_status_enum] UNP: short_term_status='FAILED_SETUP' not in READY/ARMED/WATCH/AVOID
- [short_status_enum] VRTX: short_term_status='FAILED_SETUP' not in READY/ARMED/WATCH/AVOID
- [short_status_enum] XOM: short_term_status='FAILED_SETUP' not in READY/ARMED/WATCH/AVOID
- [short_plan_all_or_nothing] ADBE: short plan partially filled (1/12); blank: short_term_entry_action,short_term_entry_price,short_term_stop_price,short_term_target_1,short_term_target_1_pct,short_term_target_2,short_term_target_2_pct,short_term_risk_per_share,short_term_rr_target_1,short_term_rr_target_2,short_term_cancel_condition
- [short_plan_all_or_nothing] CRM: short plan partially filled (1/12); blank: short_term_entry_action,short_term_entry_price,short_term_stop_price,short_term_target_1,short_term_target_1_pct,short_term_target_2,short_term_target_2_pct,short_term_risk_per_share,short_term_rr_target_1,short_term_rr_target_2,short_term_cancel_condition
- [short_plan_all_or_nothing] FISV: short plan partially filled (1/12); blank: short_term_entry_action,short_term_entry_price,short_term_stop_price,short_term_target_1,short_term_target_1_pct,short_term_target_2,short_term_target_2_pct,short_term_risk_per_share,short_term_rr_target_1,short_term_rr_target_2,short_term_cancel_condition
- [short_plan_all_or_nothing] ICE: short plan partially filled (1/12); blank: short_term_entry_action,short_term_entry_price,short_term_stop_price,short_term_target_1,short_term_target_1_pct,short_term_target_2,short_term_target_2_pct,short_term_risk_per_share,short_term_rr_target_1,short_term_rr_target_2,short_term_cancel_condition
- [short_plan_all_or_nothing] KKR: short plan partially filled (1/12); blank: short_term_entry_action,short_term_entry_price,short_term_stop_price,short_term_target_1,short_term_target_1_pct,short_term_target_2,short_term_target_2_pct,short_term_risk_per_share,short_term_rr_target_1,short_term_rr_target_2,short_term_cancel_condition
- [short_plan_all_or_nothing] KLAC: short plan partially filled (1/12); blank: short_term_entry_action,short_term_entry_price,short_term_stop_price,short_term_target_1,short_term_target_1_pct,short_term_target_2,short_term_target_2_pct,short_term_risk_per_share,short_term_rr_target_1,short_term_rr_target_2,short_term_cancel_condition
- [short_plan_all_or_nothing] MDT: short plan partially filled (1/12); blank: short_term_entry_action,short_term_entry_price,short_term_stop_price,short_term_target_1,short_term_target_1_pct,short_term_target_2,short_term_target_2_pct,short_term_risk_per_share,short_term_rr_target_1,short_term_rr_target_2,short_term_cancel_condition
- [short_plan_all_or_nothing] MSTR: short plan partially filled (1/12); blank: short_term_entry_action,short_term_entry_price,short_term_stop_price,short_term_target_1,short_term_target_1_pct,short_term_target_2,short_term_target_2_pct,short_term_risk_per_share,short_term_rr_target_1,short_term_rr_target_2,short_term_cancel_condition
- [short_plan_all_or_nothing] PM: short plan partially filled (1/12); blank: short_term_entry_action,short_term_entry_price,short_term_stop_price,short_term_target_1,short_term_target_1_pct,short_term_target_2,short_term_target_2_pct,short_term_risk_per_share,short_term_rr_target_1,short_term_rr_target_2,short_term_cancel_condition
- [short_plan_all_or_nothing] SCHW: short plan partially filled (1/12); blank: short_term_entry_action,short_term_entry_price,short_term_stop_price,short_term_target_1,short_term_target_1_pct,short_term_target_2,short_term_target_2_pct,short_term_risk_per_share,short_term_rr_target_1,short_term_rr_target_2,short_term_cancel_condition
- [short_plan_all_or_nothing] UNP: short plan partially filled (1/12); blank: short_term_entry_action,short_term_entry_price,short_term_stop_price,short_term_target_1,short_term_target_1_pct,short_term_target_2,short_term_target_2_pct,short_term_risk_per_share,short_term_rr_target_1,short_term_rr_target_2,short_term_cancel_condition
- [short_plan_all_or_nothing] VRTX: short plan partially filled (1/12); blank: short_term_entry_action,short_term_entry_price,short_term_stop_price,short_term_target_1,short_term_target_1_pct,short_term_target_2,short_term_target_2_pct,short_term_risk_per_share,short_term_rr_target_1,short_term_rr_target_2,short_term_cancel_condition
- [short_plan_all_or_nothing] XOM: short plan partially filled (1/12); blank: short_term_entry_action,short_term_entry_price,short_term_stop_price,short_term_target_1,short_term_target_1_pct,short_term_target_2,short_term_target_2_pct,short_term_risk_per_share,short_term_rr_target_1,short_term_rr_target_2,short_term_cancel_condition
- [st_cancel_text_numbers] ALAB: cancel level 386.00 vs stop 385.81
- [lt_target_above_base] ALAB: long target_2 377.87 not above current 389.88
- [st_cancel_text_numbers] AMD: cancel level 633.38 vs stop 633.06
- [st_cancel_text_numbers] ANET: cancel level 214.79 vs stop 214.68
- [lt_target_above_base] AVGO: long target_2 374.09 not above current 375.92
- [st_cancel_text_numbers] BMY: cancel level 59.24 vs stop 59.21
- [lt_target_above_base] CAT: long target_2 848.5 not above current 863.4
- [st_cancel_text_numbers] CRWD: cancel level 271.91 vs stop 271.77
- [st_cancel_text_numbers] CSCO: cancel level 117.44 vs stop 117.38
- [st_cancel_text_numbers] MRVL: cancel level 267.26 vs stop 267.13
- [st_cancel_text_numbers] NEE: cancel level 77.61 vs stop 77.57
- [st_cancel_text_numbers] NFLX: cancel level 68.46 vs stop 68.43
- [st_cancel_text_numbers] SPY: cancel level 777.96 vs stop 777.57
- [st_cancel_text_numbers] TJX: cancel level 136.26 vs stop 136.19
- [st_cancel_text_numbers] VOO: cancel level 715.10 vs stop 714.74
- [rc_price_percentile] WFC: price_percentile CSV=22.2 recomputed=25.9259 (tol 0.1)
- [rc_price_percentile] T: price_percentile CSV=11.1 recomputed=14.8148 (tol 0.1)

## Notes

- CSV has 7 AVOID rows but summary has no short_avoid key
- PART C sample: 25 symbols (21 READY/BUY NOW/BUY LOWER, all included even if > 25; 4 seeded-random others, seed 20261007); cutoff = bars with unix+60 <= scan_time 2026-10-07T05:24:10.000Z.
- ABNB: archive 10140 + main 2730 rows (2730 overlapping minutes, main wins) -> 26 sessions, last 2026-10-06 15:59 @ 160.42
- AMD: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 649.55
- AMGN: archive 10528 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 402.73
- ADBE: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 238.13
- ANET: archive 10528 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 215.36
- BMY: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 59.58
- COP: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 129.36
- FISV: archive 10140 + main 2730 rows (2730 overlapping minutes, main wins) -> 26 sessions, last 2026-10-06 15:59 @ 45.47
- CSCO: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 117.97
- INTU: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 289.71
- HOOD: archive 10140 + main 2730 rows (2730 overlapping minutes, main wins) -> 26 sessions, last 2026-10-06 15:59 @ 112.01
- GE: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 309.37
- MCD: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 232.42
- MRVL: archive 10140 + main 2730 rows (2730 overlapping minutes, main wins) -> 26 sessions, last 2026-10-06 15:59 @ 287.19
- NEE: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 77.88
- SPGI: archive 10526 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 396.07
- TMUS: archive 10527 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 165.94
- UNH: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 376.12
- UNP: archive 10515 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 276.62
- WFC: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 81.52
- XLY: archive 11305 + main 2730 rows (2730 overlapping minutes, main wins) -> 29 sessions, last 2026-10-06 15:59 @ 111.74
- PLTR: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 192.08
- T: archive 10530 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 24.43
- ABBV: archive 10528 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 266.79
- HON: archive 10516 + main 2730 rows (2730 overlapping minutes, main wins) -> 27 sessions, last 2026-10-06 15:59 @ 212.84

QA_RECOMPUTE: FAIL

# Star Planner Benchmark Baseline: current-alpha

## Environment

- Package: @found-in-space/skykit-workspace@0.1.1
- Git commit: 75f9ed1
- Node: v25.5.0
- Chromium: 148.0.7778.96
- Platform: darwin/x64

## Headline Totals

| Area | Scenarios | Key metric |
| --- | ---: | --- |
| Planner | 168 | mean plan 4.296 ms, p95 15.562 ms |
| Browser scheduler | 12 | mean live current 927.7 ms, p95 2384.3 ms |

## Slowest Planner Scenarios

| Fixture | Movement | Strategy | p95 plan ms | mean inspected | mean emitted |
| --- | --- | --- | ---: | ---: | ---: |
| uniform | teleport | composite-volume | 46.665 | 4680 | 302.8 |
| boundary-heavy | slow-drift | composite-volume | 30.27 | 7472 | 914.6 |
| boundary-heavy | stationary | composite-volume | 28.803 | 7472 | 920 |
| boundary-heavy | teleport | composite-volume | 28.411 | 7472 | 527.8 |
| boundary-heavy | cruise | composite-volume | 22.755 | 7472 | 817.8 |
| boundary-heavy | sudden-turn | composite-volume | 22.286 | 7472 | 823.8 |
| boundary-heavy | oscillation | composite-volume | 21.485 | 7472 | 857.9 |
| boundary-heavy | fast-transit | composite-volume | 20.063 | 7472 | 744 |

## Highest Tail Churn

| Fixture | Movement | Strategy | mean tail churn | hot-prefix retention |
| --- | --- | --- | ---: | ---: |
| boundary-heavy | oscillation | observer-shell | 0.97 | 0.294 |
| boundary-heavy | oscillation | motion-lookahead | 0.97 | 0.294 |
| clustered | oscillation | observer-shell | 0.958 | 0.234 |
| clustered | oscillation | motion-lookahead | 0.958 | 0.234 |
| sparse | fast-transit | target-frustum | 0.958 | 0.219 |
| sparse | oscillation | observer-shell | 0.958 | 0.176 |
| sparse | oscillation | motion-lookahead | 0.958 | 0.176 |
| boundary-heavy | oscillation | target-frustum | 0.951 | 0.216 |

## Browser Scheduler Profiles

| Profile | Workload | mean live current ms | max queue depth | frame misses | warm promotions | warm reuse |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| fast | steady-cruise | 174.6 | 48 | 0 | 0.278 | 0 |
| fast | fast-transit | 197.4 | 145 | 0 | 0 | 0 |
| fast | sudden-turn | 143.3 | 66 | 0 | 0.133 | 0 |
| fast | lookahead-heavy | 161.9 | 124 | 0 | 0.083 | 0 |
| medium | steady-cruise | 563.6 | 91 | 0 | 0.278 | 0 |
| medium | fast-transit | 1039.3 | 176 | 0 | 0 | 0 |
| medium | sudden-turn | 756.9 | 105 | 0 | 0.133 | 0 |
| medium | lookahead-heavy | 471.5 | 160 | 0 | 0.083 | 0 |
| slow | steady-cruise | 1504.3 | 100 | 0 | 0.278 | 0 |
| slow | fast-transit | 2811.3 | 180 | 0 | 0 | 0 |
| slow | sudden-turn | 2034.9 | 112 | 0 | 0.133 | 0 |
| slow | lookahead-heavy | 1273.2 | 168 | 0 | 0.083 | 0 |

## Current Contract Gaps

- Custom strategy supported: no
- Custom strategy probe failure: Star octree strategy "unknown" is not supported yet.
- This baseline intentionally records the current closed-strategy alpha behavior before the Strategy/Planner API is separated.

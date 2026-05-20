# Star Planner Benchmark Baseline: current-alpha

## Environment

- Package: @found-in-space/skykit-workspace@0.1.1
- Git commit: 863f1dc
- Node: v25.5.0
- Chromium: 148.0.7778.96
- Platform: darwin/x64

## Headline Totals

| Area | Scenarios | Key metric |
| --- | ---: | --- |
| Planner | 168 | mean plan 6.035 ms, p95 17.238 ms |
| Browser scheduler | 12 | mean live current 927.6 ms, p95 2385.9 ms |

## Slowest Planner Scenarios

| Fixture | Movement | Strategy | p95 plan ms | mean inspected | mean emitted |
| --- | --- | --- | ---: | ---: | ---: |
| sparse | fast-transit | composite-volume | 58.656 | 4884 | 201.3 |
| uniform | oscillation | lookahead-warm | 32.853 | 4680 | 43.5 |
| uniform | sudden-turn | lookahead-warm | 32.355 | 4680 | 36.833 |
| boundary-heavy | teleport | lookahead-warm | 25.167 | 7472 | 24 |
| boundary-heavy | fast-transit | composite-volume | 23.848 | 7472 | 744 |
| sparse | fast-transit | lookahead-warm | 22.868 | 4884 | 6 |
| boundary-heavy | sudden-turn | lookahead-warm | 21.667 | 7472 | 38.5 |
| boundary-heavy | sudden-turn | composite-volume | 21.359 | 7472 | 823.8 |

## Highest Tail Churn

| Fixture | Movement | Strategy | mean tail churn | hot-prefix retention |
| --- | --- | --- | ---: | ---: |
| boundary-heavy | oscillation | target-frustum | 1 | 0.216 |
| sparse | oscillation | observer-shell | 0.958 | 0.176 |
| sparse | oscillation | lookahead-warm | 0.958 | 0.176 |
| boundary-heavy | fast-transit | target-frustum | 0.94 | 0.362 |
| uniform | oscillation | target-frustum | 0.923 | 0.415 |
| sparse | fast-transit | target-frustum | 0.917 | 0.219 |
| sparse | sudden-turn | target-frustum | 0.917 | 0.292 |
| sparse | oscillation | target-frustum | 0.917 | 0.153 |

## Browser Scheduler Profiles

| Profile | Workload | mean live current ms | max queue depth | frame misses | warm promotions | warm reuse |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| fast | steady-cruise | 168.9 | 48 | 0 | 0.278 | 0 |
| fast | fast-transit | 198.3 | 147 | 0 | 0 | 0 |
| fast | sudden-turn | 142.3 | 65 | 0 | 0.133 | 0 |
| fast | lookahead-heavy | 161.3 | 124 | 0 | 0.083 | 0 |
| medium | steady-cruise | 565.3 | 91 | 0 | 0.278 | 0 |
| medium | fast-transit | 1036.4 | 176 | 0 | 0 | 0 |
| medium | sudden-turn | 757.1 | 104 | 0 | 0.133 | 0 |
| medium | lookahead-heavy | 471.1 | 160 | 0 | 0.083 | 0 |
| slow | steady-cruise | 1507 | 100 | 0 | 0.278 | 0 |
| slow | fast-transit | 2813.5 | 180 | 0 | 0 | 0 |
| slow | sudden-turn | 2036 | 112 | 0 | 0.133 | 0 |
| slow | lookahead-heavy | 1273.7 | 168 | 0 | 0.083 | 0 |

## Current Contract Gaps

- Custom strategy supported: yes
- Custom strategy probe failure: none
- This baseline records the open Strategy/Planner contract: benchmark scenarios are labels, while planner inputs are first-class strategy objects.

# Local sensors, transferable skill: neuroevolution of racing controllers

*Self-learning vehicles, project report. Data generated 2026-11-26 with `npm run experiments`.*

## Abstract

Populations of 100 cars and 100 bikes learn to drive closed race tracks with a small neural network (8 inputs, 10 hidden units, 2 outputs; 112 weights) trained only by a genetic algorithm. Each vehicle perceives the world through seven distance rays and its own speed. Everything, from the physics and sensors to the network and the genetic algorithm, is written from scratch in TypeScript, and the simulation runs on a fixed timestep with seeded randomness, so every result here is reproducible. Four experiments on a harder family of procedurally generated tracks show that: (1) a population trained on a single track completes a lap on 55–59% of attempts on 50 tracks it has never seen, against 0% for random networks; (2) cars and bikes learn at statistically indistinguishable speeds; (3) a population moved from one track to another learns the new one in a median of 1 generation instead of 11.5 (20 of 20 track pairs, p < 0.001), and the crashes that remain concentrate at corners tighter than anything in the training track; (4) cutting the sensors from seven rays to three slows learning sharply and suggests worse generalization (p = 0.053), while five rays perform as well as seven.

## 1. Question

A controller that only sees *local* information, the distance to the nearest wall in a few directions, cannot memorise a track: it has no position, no map and no notion of what comes next. The hypothesis behind this project is that such a controller therefore learns a *skill* (how to react to walls at a given distance and speed) rather than a *route*, and that this skill should carry over to unseen tracks, failing mainly where the new track demands something the old one never did. The experiments test that hypothesis and two practical questions around it: do the two vehicle types differ in how fast they learn, and how much perception does the skill need.

## 2. System

**Simulation.** Tracks are closed Hermite splines, 14 m wide, sampled every 2 m, with checkpoints every ~10 m. Vehicles follow simple kinematic physics at a fixed 60 Hz step: throttle, braking and speed-dependent steering, with bikes faster but gripping less than cars. Contact with a wall is classified by impact angle and speed as a *scrape* (adds damage; the vehicle keeps driving until damage reaches a limit) or a *crash* (out at once). A vehicle that passes no checkpoint for 2 s is removed, and a generation ends when every vehicle is out or after 90 simulated seconds.

**Perception.** Seven rays at −90°, −60°, −30°, 0°, 30°, 60° and 90° from the heading, each reporting the distance to the nearest wall up to 40 m (normalised to 0–1), plus normalised speed.

**Controller.** A fully connected 8 → 10 → 2 network with tanh activations. The outputs are steering and throttle, evaluated every tick.

**Learning.** A generational genetic algorithm over 100 networks. Fitness is checkpoints passed plus fractional progress to the next one, minus three times the damage taken, plus a lap-time bonus that only lapping vehicles earn. The five best networks are copied unchanged (elitism); the rest are children of parents chosen by tournaments of 20, with uniform crossover and Gaussian mutation (rate 0.3, standard deviation 0.3).

## 3. Method

**Tracks.** The app's random tracks proved too easy to measure anything on: random networks lap them within 2–3 generations, because among 100 random controllers one usually gets lucky. The experiments therefore use a *hard* track family (14–20 control points, 40% chance of a pinched hairpin or chicane at each, minimum radius 9 m). Tellingly, the harder shapes alone changed little; what made learning measurable was a stricter milestone (below).

**Milestones.** *First lap*: the first generation in which any vehicle completes a lap. *Learned*: the first generation in which at least half the population (50 of 100) completes a lap. The second captures the population acquiring the skill, not one lucky individual, and is the main outcome measure. Runs that do not reach a milestone within 40 generations are censored and ranked after all runs that did.

**Completion.** One frozen attempt (no evolution) of a whole population on a track: the share that completes a lap, the same definition as the app's Test mode.

**Statistics.** Summaries are means or medians with 95% percentile bootstrap confidence intervals (4,000 resamples, seeded). Paired comparisons (same tracks, same seeds) use the two-sided Wilcoxon signed-rank test with normal approximation, tie and continuity correction. The statistics code is in `src/stats.ts` and is unit-tested against hand-worked examples.

**Experiments.**

1. *Generalisation.* The shipped pre-trained populations (trained 30 generations on the default track only) and 100 random networks, one attempt each on 50 unseen hard tracks.
2. *Cars vs bikes.* Both from random networks on the same 30 hard tracks with the same seeds; generations to *first lap* and to *learned*.
3. *Transfer.* For 20 pairs of hard tracks (A, B): cars learn A and train 10 more generations; that population then evolves on B, against random networks on B with the same seed. Outcome: generations to *learned* on B. For the corner analysis, every corner of B (contiguous centreline samples with radius under 40 m) is flagged if it is tighter than the tightest corner of A, and the wall contacts the transferred population makes at each corner during one attempt are counted.
4. *Sensor ablation.* Networks that see 3 rays (−90°, 0°, 90°), 5 rays (−90°, −30°, 0°, 30°, 90°) or all 7, each plus speed. For each of 10 training tracks (shared across settings), a population learns the track and trains 10 more generations, then makes one attempt on each of 10 further unseen tracks; the outcome is its mean completion.

All 210 runs took 35 minutes on 8 parallel processes.

## 4. Results

| | Result | Statistic |
|---|---|---|
| 1. Generalisation | Pre-trained cars complete **59%** (95% CI 58–59%), bikes **55%** (55–56%) on 50 unseen tracks; random networks **0%** | p < 0.001 |
| 2. Cars vs bikes | Median generations to *learned*: cars **10**, bikes **9**; to *first lap*: 3 vs 2 | median paired difference 2 (95% CI −0.5 to 2.5), **p = 0.345** |
| 3. Transfer | Median generations to *learned* on B: **1** after training on A vs **11.5** from scratch; sooner on **20 of 20** pairs | median saving 10.5 generations (95% CI 7.5–13), p < 0.001 |
| 3. Corners | Corners tighter than anything on A are **11%** of corners (12 of 113) but drew **35%** of crashes (15 of 43); **7.1** wall contacts per corner vs 3.4 elsewhere | descriptive |
| 4. Ablation | Completion on unseen tracks: 3 rays **37%** (31–43%), 5 rays **50%** (46–53%), 7 rays **45%** (39–52%). Median generations to *learned*: 35.5, 10, 9.5; three of ten 3-ray runs never learned within 40 | 3 vs 7: p = 0.053; 5 vs 7: p = 0.154 |

## 5. Discussion

**Transfer is the clearest effect.** A population that has learned one track needs almost nothing to learn the next: on 14 of 20 pairs it reached the *learned* milestone in the very first generation on the new track. This is what the local-sensor hypothesis predicts. Experiment 1 says the same from another angle: a population that only ever saw the default track completes most unseen tracks without any further training.

**Where transfer fails is also predictable.** Crashes on the new track concentrate at corners tighter than anything in the old one, about three times their share of corners. The skill learned is bounded by the situations met during training, which is a small, concrete instance of the general problem of out-of-distribution generalisation.

**Vehicle type does not matter for learning speed.** Bikes are faster and grip less, and a naive look at medians suggests they learn a generation sooner, but across 30 paired tracks the difference is not significant. With identical networks and learning rules, the dynamics differ less than the variation between tracks.

**Perception needs a minimum, then saturates.** Three rays leave the network blind to the 30–60° directions that a corner entry is seen through: learning slows from about 10 generations to over 35 and generalisation probably suffers. Five rays already match seven. More sensors are not automatically better; what matters is covering the directions that the task depends on.

## 6. Limitations

- **Sample sizes are modest** (20–50 tracks per comparison, 10 training tracks in the ablation). The 3-vs-7-ray result (p = 0.053) is suggestive, not conclusive, and no correction is applied across the handful of tests reported.
- **One learning algorithm and one architecture.** The conclusions are about this genetic algorithm and this network; gradient-based reinforcement learning or larger networks might behave differently.
- **Simplified physics.** The vehicle model is kinematic, with no tyre model, weight transfer or sensor noise. Transfer to anything physical would need noise and a far richer model.
- **The hard track family is still procedurally narrow**, and the 40-generation cap censors a few slow runs (three, all in the 3-ray setting).
- **The pre-trained populations in Experiment 1 are the app's shipped files**, trained for 30 generations; their exact completion rate depends on that training budget.

## 7. Next steps

1. **Curriculum and diversity.** Train on a sequence of tracks of increasing tightness and test whether the "tighter-than-training" crashes disappear, i.e. whether the failure in Experiment 3 is fixed by coverage.
2. **A generalist.** Train on a fresh random track every generation and compare it with the single-track specialist on unseen tracks.
3. **Compare learners.** The same task with a policy-gradient method (for example PPO) and with CMA-ES, at matched simulation budgets.
4. **Noise.** Add sensor and actuation noise and measure how much transfer survives, a first step toward the sim-to-real question.

## Reproducing

```bash
npm install
npm test               # unit tests, including the statistics and the learning-speed checks
npm run experiments    # ~35 min on 8 cores; writes public/results/experiments.json
npm run dev            # the Results page at /results.html reads that file
```

Code: `src/sim` (simulation and sensors), `src/ml` (network and genetic algorithm), `src/stats.ts` (statistics), `scripts/experiments.ts` (the experiments above).

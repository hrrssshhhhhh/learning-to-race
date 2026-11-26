# Self-learning vehicles

100 cars and 100 bikes start with random brains and teach themselves to race any track you draw. Each vehicle has a small neural network; a genetic algorithm keeps the best drivers and breeds the next generation. The neural network, the genetic algorithm, the physics and the sensors are all written from scratch in TypeScript, with no ML libraries.

**Live:** _link added at launch_ · **Results:** [`/results.html`](results.html)

![Cars and bikes learning the default circuit](docs/demo.gif)
<!-- docs/demo.gif is recorded by hand after launch -->

## What you can do

- Watch both populations learn the default circuit in 3D (chase, orbit or top camera) or 2D.
- Draw your own track and race on it. Invalid drawings (too small, self-crossing, corners too tight) are rejected with a reason.
- Start from random brains, your own saved vehicles, or the shipped pre-trained population.
- Test on an unseen track: pre-trained, random and your own vehicles, side by side, one attempt each, with completion rates.
- Follow the leader's live neural network, damage and lap times in the side panel.

## How it works

```
 7 distance rays + speed          neural network            controls
 ─────────────────────────►   8 → 10 → 2  (112 weights)  ─►  steer, throttle
          ▲                                                      │
          │                       physics + walls                ▼
          └──────────── sensors ◄── vehicle state ◄──── fixed 60 Hz step
                                         │
                       fitness: checkpoints + lap time − damage
                                         │
                 genetic algorithm: keep top 5, tournament of 20, mutate 30%
```

| Folder | What lives there |
|---|---|
| `src/sim` | Tracks, random track generator, car and bike physics, sensors, wall contact, the world loop |
| `src/ml` | Neural network and genetic algorithm |
| `src/render2d`, `src/render3d` | 2D broadcast map and the Three.js night circuit |
| `src/editor` | Track drawing |
| `src/ui` | Landing, controls, side panel, charts, network diagram |
| `src/storage` | Saving and loading populations |
| `scripts` | Headless pre-training and experiments |

The simulation runs on a fixed timestep, so results never depend on frame rate, and every run is seeded, so the experiments are reproducible.

## Run it

```bash
npm install
npm run dev            # the app at http://localhost:5173
npm test               # unit tests, plus the learning-speed checks
npm run build          # typecheck and production build
npm run pretrain       # re-train the shipped population (about 2 min)
npm run experiments    # re-run the experiments behind the Results page
```

## Results

Three experiments, run headless with the same simulation as the browser (`npm run experiments`, about 20 minutes). The full charts and data are on the [Results page](results.html).

| Question | Result |
|---|---|
| Does pre-training carry over to unseen tracks? | Trained on the default track only, the shipped population completes a lap on **62%** of attempts across 50 tracks it has never seen (cars and bikes alike). Random brains: **0%**. |
| Who learns faster from scratch? | On 20 random tracks, **bikes** reach a first lap in a median of **generation 2**, cars in **generation 3**. Both lapped every track. |
| Does learning one track help on the next? | Cars trained on track A lapped a new track B **in their first generation on all 20 pairs**, against a median of generation 2 from scratch (18 sooner, 2 ties). |
| Which corners still cause trouble? | Every crash on track B came at a corner tighter than anything on track A; corners A had already taught drew no crashes. |

Why transfer works: the sensors are local, so a brain never learns a track. It learns how to react to walls at a given distance and speed, and that carries to any track whose corners it has already met.

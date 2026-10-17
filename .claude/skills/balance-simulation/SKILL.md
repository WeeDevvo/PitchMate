---
name: balance-simulation
description: Run the real TeamBalancer and OpenSkill rating engine against mock squad rosters and interpret the proposed splits.
disable-model-invocation: true
---

# Balance simulation

`backend/tools/BalanceSimulation/simulate.cs` is a .NET 10 file-based app. It references `PitchMate.Infrastructure` directly and runs the production `TeamBalancer` over the production `PlackettLuceRatingEngine` (default `RatingEngineConfig`). It is outside `PitchMate.slnx` and never deployed.

## Run

From the repo root:

```bash
dotnet run backend/tools/BalanceSimulation/simulate.cs -- [--scenario <name>|all] [--players <2..16>] [--seed <int>] [--roster "mu:sigma,..."]
```

| Scenario | Roster |
|---|---|
| `even` | everyone on the default prior (μ 25, σ 8.33) |
| `mixed` | established players spread linearly from μ 18 to 32, σ 2.5 |
| `stars` | two μ 34 players among μ 24 regulars |
| `newcomers` | alternating established (μ 27, σ 2) and brand-new players |
| `uncertainty` | identical μ, σ ranging from 1.5 to 8.33 |
| `random` | seeded random μ 15–35, σ 1.5–8.33 |

`--roster` replaces the scenario with your own players. A σ left out defaults to 8.33 (e.g. `--roster "30:2,25,22:3,28"`). The exit code is non-zero if the balancer rejects the request or a proposal is not an exact partition.

## Read the output

Each team shows its predicted win probability, mean μ, mean σ and roster. The footer shows draw probability, the win gap between the teams, whether the proposal is an exact partition, and the time taken.

- **Win gap** is the balancer's objective (closest to 50/50). A non-zero gap on `mixed` can be the best achievable for that roster, not a defect.
- **Draw probability** is the tie-breaker: among equally fair splits, the higher-draw (less skill-concentrated) one wins.
- **Mean σ per team** shows uncertainty concentration. The engine's `Predict` barely separates splits with equal μ, so `uncertainty` currently puts all the settled players on one team and all the newcomers on the other. That is a known balancing weakness worth checking after any change to the balancer or the rating engine.
- **`stars`** is fair only when the two stars land on opposite teams.

## Compare before and after a change

Run the scenarios on `main` and on the branch with the same `--players` and `--seed`, save both outputs to scratch files, and diff them. Report each scenario whose split, win gap or draw probability moved, with the before and after values.

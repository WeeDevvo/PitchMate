Run the production OpenSkill team balancer simulation against mock or custom squad rosters.

Arguments: `$ARGUMENTS` (e.g. `--scenario stars`, `--scenario all`, `--players 10`, `--seed 42`, or `--roster "mu:sigma,..."`).

Execute the runner:
```bash
dotnet run backend/tools/BalanceSimulation/simulate.cs -- $ARGUMENTS
```

Available Scenarios:
- `even`: Default prior (μ 25.0, σ 8.33) for all players.
- `mixed`: Established players spread linearly from μ 18 to 32 (σ 2.5).
- `stars`: Two μ 34 players among μ 24 regulars.
- `newcomers`: Alternating established (μ 27, σ 2) and brand-new players.
- `uncertainty`: Identical μ with σ ranging from 1.5 to 8.33.
- `random`: Seeded random μ 15–35, σ 1.5–8.33.
- `all`: Runs all scenarios.

Output analysis:
- **Win gap**: The balancer's primary goal (target: closest to 50/50 balance).
- **Draw probability**: Tie-breaker between splits with identical win gaps (higher is preferred).
- **Team mean μ and σ**: Checks skill and uncertainty distribution across both sides.
- **Exact partition**: Confirms every player is assigned exactly once with no dropouts.

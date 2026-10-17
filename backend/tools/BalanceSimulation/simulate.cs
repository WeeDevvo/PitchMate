#:project ../../src/PitchMate.Infrastructure/PitchMate.Infrastructure.csproj

// Team-balancing simulation: runs the real TeamBalancer over the real PlackettLuceRatingEngine against
// mock squad rosters, so a change to the balancer or the rating engine can be eyeballed before it ships.
// Not part of PitchMate.slnx and never deployed. Usage (from the repo root):
//
//   dotnet run backend/tools/BalanceSimulation/simulate.cs -- [--scenario <name>|all] [--players <2..16>]
//                                                             [--seed <int>] [--roster "mu:sigma,mu:sigma,..."]
//
// Scenarios: even, mixed, stars, newcomers, uncertainty, random. --roster overrides --scenario.

using System.Diagnostics;
using System.Globalization;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure;
using PitchMate.Infrastructure.Matches;

const double NewcomerSigma = 25.0 / 3.0;
string[] scenarioNames = ["even", "mixed", "stars", "newcomers", "uncertainty", "random"];

string scenario = "all";
int players = 10;
int seed = 42;
string? roster = null;

for (int i = 0; i < args.Length; i++)
{
    string value = i + 1 < args.Length ? args[i + 1] : string.Empty;
    switch (args[i])
    {
        case "--scenario": scenario = value; i++; break;
        case "--players": players = int.Parse(value, CultureInfo.InvariantCulture); i++; break;
        case "--seed": seed = int.Parse(value, CultureInfo.InvariantCulture); i++; break;
        case "--roster": roster = value; i++; break;
        default:
            Console.Error.WriteLine($"Unknown argument '{args[i]}'.");
            return 2;
    }
}

if (players is < 2 or > 16)
{
    Console.Error.WriteLine("--players must be between 2 and 16 (the balancer's brute-force bound).");
    return 2;
}

var balancer = new TeamBalancer(new PlackettLuceRatingEngine(new RatingEngineConfig()));

List<(string Name, Rating[] Ratings)> runs = [];
if (roster is not null)
{
    runs.Add(("custom", ParseRoster(roster)));
}
else if (scenario == "all")
{
    runs.AddRange(scenarioNames.Select(name => (name, BuildScenario(name, players, seed))));
}
else if (scenarioNames.Contains(scenario))
{
    runs.Add((scenario, BuildScenario(scenario, players, seed)));
}
else
{
    Console.Error.WriteLine($"Unknown scenario '{scenario}'. Choose one of: all, {string.Join(", ", scenarioNames)}.");
    return 2;
}

int failures = 0;
foreach ((string name, Rating[] ratings) in runs)
{
    failures += await RunAsync(name, ratings) ? 0 : 1;
}

return failures == 0 ? 0 : 1;

async Task<bool> RunAsync(string name, Rating[] ratings)
{
    // Deterministic membership ids so a player's label maps back from the proposal.
    Guid[] ids = ratings.Select((_, index) => new Guid(index + 1, 0, 0, new byte[8])).ToArray();
    var participants = ratings.Select((rating, index) => new BalancerParticipant(ids[index], rating)).ToArray();

    var stopwatch = Stopwatch.StartNew();
    var result = await balancer.ProposeAsync(new TeamBalanceRequest(participants, TeamCount: 2), CancellationToken.None);
    stopwatch.Stop();

    Console.WriteLine($"=== {name} ({ratings.Length} players) ===");
    if (!result.IsSuccess)
    {
        Console.WriteLine($"  FAILED: {result.Error?.Message}");
        Console.WriteLine();
        return false;
    }

    TeamProposal proposal = result.Value!;
    var assigned = proposal.Teams.SelectMany(team => team.ParticipantMembershipIds).ToList();
    bool exactPartition = assigned.Count == ids.Length && assigned.ToHashSet().SetEquals(ids);

    for (int t = 0; t < proposal.Teams.Count; t++)
    {
        ProposedTeamAssignment team = proposal.Teams[t];
        int[] members = team.ParticipantMembershipIds.Select(id => Array.IndexOf(ids, id)).ToArray();
        double meanMu = members.Average(index => ratings[index].Mu);
        double meanSigma = members.Average(index => ratings[index].Sigma);

        Console.WriteLine(
            $"  Team {(char)('A' + t)}  win {team.WinProbability:P1}  mean mu {meanMu:F2}  mean sigma {meanSigma:F2}");
        foreach (int index in members.OrderByDescending(index => ratings[index].Mu))
        {
            Console.WriteLine($"    P{index + 1:D2}  mu {ratings[index].Mu,6:F2}  sigma {ratings[index].Sigma,5:F2}");
        }
    }

    double gap = Math.Abs(proposal.Teams[0].WinProbability - proposal.Teams[1].WinProbability);
    Console.WriteLine(
        $"  draw {proposal.DrawProbability:P1}  win gap {gap:P2}  exact partition {(exactPartition ? "yes" : "NO")}  {stopwatch.ElapsedMilliseconds} ms");
    Console.WriteLine();
    return exactPartition;
}

static Rating[] BuildScenario(string name, int count, int seed)
{
    var random = new Random(seed);
    return name switch
    {
        // Brand-new squad: everyone on the default prior.
        "even" => Enumerable.Repeat(new Rating(25.0, NewcomerSigma), count).ToArray(),
        // Established squad with a linear spread of skill.
        "mixed" => Enumerable.Range(0, count)
            .Select(i => new Rating(18.0 + (14.0 * i / Math.Max(1, count - 1)), 2.5))
            .ToArray(),
        // Two standout players among an average squad; a fair split puts them on opposite teams.
        "stars" => Enumerable.Range(0, count)
            .Select(i => i < 2 ? new Rating(34.0, 2.0) : new Rating(24.0, 2.5))
            .ToArray(),
        // Half established players, half provisional newcomers.
        "newcomers" => Enumerable.Range(0, count)
            .Select(i => i % 2 == 0 ? new Rating(27.0, 2.0) : new Rating(25.0, NewcomerSigma))
            .ToArray(),
        // Identical means, uncertainty ranging from settled to brand new.
        "uncertainty" => Enumerable.Range(0, count)
            .Select(i => new Rating(25.0, 1.5 + ((NewcomerSigma - 1.5) * i / Math.Max(1, count - 1))))
            .ToArray(),
        // Seeded random squad.
        "random" => Enumerable.Range(0, count)
            .Select(_ => new Rating(15.0 + (random.NextDouble() * 20.0), 1.5 + (random.NextDouble() * (NewcomerSigma - 1.5))))
            .ToArray(),
        _ => throw new ArgumentOutOfRangeException(nameof(name), name, "Unknown scenario."),
    };
}

static Rating[] ParseRoster(string roster) =>
    roster.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Select(entry => entry.Split(':'))
        .Select(parts => new Rating(
            double.Parse(parts[0], CultureInfo.InvariantCulture),
            parts.Length > 1 ? double.Parse(parts[1], CultureInfo.InvariantCulture) : NewcomerSigma))
        .ToArray();

using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Matches.Repositories;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Squads.Repositories;
using PlayerRating = PitchMate.Domain.Rating.Rating;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// Materialises a <see cref="StatsDatasetSpec"/> into a real <see cref="PitchMateDbContext"/> by
/// building the actual domain aggregates through their lifecycle — so the persisted rows are exactly
/// what production writes — and returns the resolved <see cref="SeededStatsDataset"/> the reference
/// <see cref="StatsReferenceOracle"/> and the model-based property tests (tasks 6.2–6.11) read.
/// <para>
/// Each squad's memberships are created active (registered with a distinct user, or guest), then its
/// matches are driven to their target state: teamless states stop at draft/confirm/cancel, while
/// rolled states pick a roster from the pool by a deterministic shuffle, add the members as
/// participants, apply a partitioned team proposal, and lock — capturing the immutable kickoff lineup
/// the aggregation reads. A completed match additionally records its per-team scores, completes at a
/// distinct instant, and writes one <see cref="RatingSnapshot"/> per participant. Lifecycle transforms
/// (deactivation, anonymisation) are applied <em>after</em> the matches are built, so an inactive or
/// anonymised membership keeps the history it contributed. Everything is persisted in a single unit of
/// work so the change tracker orders the inserts to satisfy the foreign keys.
/// </para>
/// </summary>
public sealed class StatsDatasetSeeder
{
    /// <summary>
    /// Seeds <paramref name="spec"/> into <paramref name="context"/> and returns the resolved dataset.
    /// </summary>
    /// <param name="context">The context to persist into; its clock stamps audit fields and seeds match timing.</param>
    /// <param name="spec">The abstract dataset to materialise.</param>
    /// <param name="clock">The time source the seeder derives match timing from.</param>
    /// <param name="cancellationToken">A token to cancel the seeding.</param>
    /// <returns>The resolved, identity-bearing dataset mirroring what was persisted.</returns>
    public async Task<SeededStatsDataset> SeedAsync(
        PitchMateDbContext context,
        StatsDatasetSpec spec,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(spec);
        ArgumentNullException.ThrowIfNull(clock);

        DateTimeOffset now = clock.GetUtcNow();
        var squadRepo = new EfSquadRepository(context);
        var memberRepo = new EfSquadMembershipRepository(context);
        var matchRepo = new EfMatchRepository(context);
        var ratingRepo = new EfMembershipRatingRepository(context);

        var seededSquads = new List<SeededStatsDataset.SquadData>(spec.Squads.Count);

        for (int s = 0; s < spec.Squads.Count; s++)
        {
            StatsDatasetSpec.SquadSpec squadSpec = spec.Squads[s];

            Squad squad = Create(Squad.Create($"Squad {s}"), "create squad");
            squad.SetFeature(SquadFeature.LiveMatchTracking, squadSpec.LiveMatchTracking);
            await squadRepo.AddAsync(squad, cancellationToken);

            // --- Memberships (created active; transforms applied after matches are built). ---
            var entities = new List<SquadMembership>(squadSpec.Members.Count);
            for (int i = 0; i < squadSpec.Members.Count; i++)
            {
                StatsDatasetSpec.MembershipSpec memberSpec = squadSpec.Members[i];
                string name = $"S{s}M{i}";
                SquadMembership member = memberSpec.IsGuest
                    ? Create(SquadMembership.CreateGuest(squad.Id, name, skillTier: null, lawfulBasisAckAt: now), "create guest")
                    : Create(SquadMembership.CreateRegistered(squad.Id, Guid.CreateVersion7(), name), "create member");

                entities.Add(member);
                await memberRepo.AddAsync(member, cancellationToken);
            }

            // --- Matches (built through the aggregate lifecycle to the target state). ---
            var seededMatches = new List<SeededStatsDataset.MatchData>(squadSpec.Matches.Count);
            for (int m = 0; m < squadSpec.Matches.Count; m++)
            {
                BuiltMatch built = BuildMatch(squad, entities, squadSpec.Matches[m], now, m);
                await matchRepo.AddAsync(built.Match, cancellationToken);
                foreach (RatingSnapshot snapshot in built.Snapshots)
                {
                    await context.Set<RatingSnapshot>().AddAsync(snapshot, cancellationToken);
                }

                seededMatches.Add(built.Data);
            }

            // --- Current ratings for the memberships that carry one. ---
            for (int i = 0; i < squadSpec.Members.Count; i++)
            {
                StatsDatasetSpec.RatingSpec? rating = squadSpec.Members[i].Rating;
                if (rating is not null)
                {
                    await ratingRepo.AddAsync(
                        MembershipRating.Create(entities[i].Id, new PlayerRating(rating.Mu, rating.Sigma)),
                        cancellationToken);
                }
            }

            // --- Apply lifecycle transforms now the history has been recorded, then snapshot the
            //     final membership state for the resolved model. ---
            var seededMembers = new List<SeededStatsDataset.MembershipData>(squadSpec.Members.Count);
            for (int i = 0; i < squadSpec.Members.Count; i++)
            {
                StatsDatasetSpec.MembershipSpec memberSpec = squadSpec.Members[i];
                SquadMembership member = entities[i];

                if (memberSpec.Inactive)
                {
                    member.Deactivate();
                }

                if (memberSpec.Anonymise)
                {
                    member.Anonymise();
                }

                seededMembers.Add(new SeededStatsDataset.MembershipData(
                    member.Id,
                    member.DisplayName,
                    member.State,
                    member.IsGuest,
                    memberSpec.Anonymise,
                    memberSpec.Rating?.Mu,
                    memberSpec.Rating?.Sigma));
            }

            seededSquads.Add(new SeededStatsDataset.SquadData(
                squad.Id, squadSpec.LiveMatchTracking, seededMembers, seededMatches));
        }

        await new UnitOfWork(context).SaveChangesAsync(cancellationToken);
        return new SeededStatsDataset(seededSquads);
    }

    /// <summary>Builds one match to its target state, returning the aggregate, its snapshots, and the resolved model.</summary>
    private static BuiltMatch BuildMatch(
        Squad squad,
        IReadOnlyList<SquadMembership> pool,
        StatsDatasetSpec.MatchSpec spec,
        DateTimeOffset now,
        int matchSequence)
    {
        Guid matchId = Guid.CreateVersion7();
        DateTimeOffset candidateDay = now.AddDays(7);

        Match match = Create(
            Match.CreateDraft(matchId, squad.Id, $"Location {matchSequence}", new[] { candidateDay }, now),
            "create draft");

        if (spec.State == MatchState.GatheringAvailability)
        {
            return TeamlessMatch(match, matchId, MatchState.GatheringAvailability, spec.Fidelity);
        }

        Check(match.Confirm(candidateDay, availableCount: 0, minimumThreshold: 0, Array.Empty<RegisteredMember>()), "confirm");

        if (spec.State == MatchState.Confirmed)
        {
            return TeamlessMatch(match, matchId, MatchState.Confirmed, spec.Fidelity);
        }

        if (spec.State == MatchState.Cancelled)
        {
            Check(match.Cancel(), "cancel");
            return TeamlessMatch(match, matchId, MatchState.Cancelled, spec.Fidelity);
        }

        // --- Rolled states need a roster drawn from the pool and partitioned into teams. ---
        int total = spec.TeamSizes.Sum();
        if (total > pool.Count)
        {
            throw new InvalidOperationException(
                $"Match roster of {total} exceeds the squad pool of {pool.Count}; the generator must keep totals within the pool.");
        }

        List<int> chosen = ShufflePoolIndices(pool.Count, spec.ShuffleSeed).Take(total).ToList();
        foreach (int index in chosen)
        {
            Check(match.AddParticipant(pool[index]), "add participant");
        }

        IReadOnlyList<IReadOnlyList<int>> teamsByIndex = Partition(chosen, spec.TeamSizes);
        var proposals = new List<ProposedTeam>(teamsByIndex.Count);
        for (int t = 0; t < teamsByIndex.Count; t++)
        {
            List<Guid> roster = teamsByIndex[t].Select(index => pool[index].Id).ToList();
            proposals.Add(new ProposedTeam(TeamName(t), BibFlag: t == spec.BibTeamIndex, roster));
        }

        Check(match.ApplyTeamProposal(proposals), "apply team proposal");
        Check(match.Lock(), "lock");

        // The working teams are captured one-to-one and in proposal order.
        List<MatchTeam> teamEntities = match.Teams.ToList();

        if (spec.State == MatchState.TeamsRolled)
        {
            return new BuiltMatch(match, [], RolledMatchData(matchId, MatchState.TeamsRolled, null, spec.Fidelity, teamEntities, scores: null));
        }

        Check(match.Start(), "start");

        if (spec.State == MatchState.InProgress)
        {
            return new BuiltMatch(match, [], RolledMatchData(matchId, MatchState.InProgress, null, spec.Fidelity, teamEntities, scores: null));
        }

        // --- Completed: record scores, complete at a distinct instant, and snapshot each participant. ---
        var teamScores = new List<TeamScore>(teamEntities.Count);
        for (int t = 0; t < teamEntities.Count; t++)
        {
            teamScores.Add(new TeamScore(teamEntities[t].Id, spec.Scores[t]));
        }

        bool liveTracking = squad.IsFeatureEnabled(SquadFeature.LiveMatchTracking);
        Check(match.RecordResult(new MatchResult(spec.Fidelity, teamScores), liveTracking), "record result");

        DateTimeOffset completedAt = now.AddDays(8).AddSeconds(spec.CompletedOffsetSeconds);
        Check(match.Complete(completedAt), "complete");

        var snapshotEntities = new List<RatingSnapshot>(chosen.Count);
        var snapshotData = new List<SeededStatsDataset.SnapshotData>(chosen.Count);
        foreach (int index in chosen)
        {
            Guid membershipId = pool[index].Id;
            (double mu, double sigma) = SnapshotRating(matchSequence, index);
            snapshotEntities.Add(RatingSnapshot.Capture(matchId, membershipId, new PlayerRating(mu, sigma)));
            snapshotData.Add(new SeededStatsDataset.SnapshotData(membershipId, mu, sigma));
        }

        SeededStatsDataset.MatchData data = RolledMatchData(
            matchId, MatchState.Completed, completedAt, spec.Fidelity, teamEntities, spec.Scores);

        return new BuiltMatch(match, snapshotEntities, data with { Snapshots = snapshotData });
    }

    private static BuiltMatch TeamlessMatch(Match match, Guid matchId, MatchState state, ResultFidelity fidelity) =>
        new(match, [], new SeededStatsDataset.MatchData(matchId, state, CompletedAt: null, fidelity, Teams: [], Snapshots: []));

    private static SeededStatsDataset.MatchData RolledMatchData(
        Guid matchId,
        MatchState state,
        DateTimeOffset? completedAt,
        ResultFidelity fidelity,
        IReadOnlyList<MatchTeam> teamEntities,
        IReadOnlyList<int>? scores)
    {
        var teams = new List<SeededStatsDataset.TeamData>(teamEntities.Count);
        for (int t = 0; t < teamEntities.Count; t++)
        {
            MatchTeam team = teamEntities[t];
            teams.Add(new SeededStatsDataset.TeamData(
                team.Id,
                team.TeamName,
                team.BibFlag,
                scores is null ? 0 : scores[t],
                team.Roster.ToList()));
        }

        return new SeededStatsDataset.MatchData(matchId, state, completedAt, fidelity, teams, Snapshots: []);
    }

    /// <summary>A deterministic permutation of the pool indices <c>[0, count)</c> seeded by <paramref name="seed"/>.</summary>
    private static List<int> ShufflePoolIndices(int count, int seed)
    {
        var indices = Enumerable.Range(0, count).ToList();
        var random = new Random(seed);
        for (int i = count - 1; i > 0; i--)
        {
            int j = random.Next(i + 1);
            (indices[i], indices[j]) = (indices[j], indices[i]);
        }

        return indices;
    }

    /// <summary>Splits <paramref name="chosen"/> into consecutive chunks of the given <paramref name="sizes"/>.</summary>
    private static IReadOnlyList<IReadOnlyList<int>> Partition(IReadOnlyList<int> chosen, IReadOnlyList<int> sizes)
    {
        var teams = new List<IReadOnlyList<int>>(sizes.Count);
        int offset = 0;
        foreach (int size in sizes)
        {
            teams.Add(chosen.Skip(offset).Take(size).ToList());
            offset += size;
        }

        return teams;
    }

    /// <summary>
    /// A deterministic per-participant snapshot (μ, σ) varied across matches and members so both
    /// provisional and established ratings occur; the resolved model records the exact values persisted.
    /// </summary>
    private static (double Mu, double Sigma) SnapshotRating(int matchSequence, int memberIndex)
    {
        double mu = 20.0 + ((matchSequence * 3) + (memberIndex * 7)) % 15;
        double sigma = 0.5 + (((matchSequence * 2) + (memberIndex * 5)) % 9);
        return (mu, sigma);
    }

    /// <summary>The distinct, locked team name for the team at <paramref name="index"/> (A, B, C, …).</summary>
    private static string TeamName(int index) => $"Team {(char)('A' + index)}";

    private static void Check(PitchMate.Domain.Matches.Result result, string step)
    {
        if (!result.IsSuccess)
        {
            throw new InvalidOperationException($"Seeder step '{step}' failed: {result.Error?.Message}");
        }
    }

    private static void Check<T>(PitchMate.Domain.Matches.Result<T> result, string step)
    {
        if (!result.IsSuccess)
        {
            throw new InvalidOperationException($"Seeder step '{step}' failed: {result.Error?.Message}");
        }
    }

    private static Match Create(PitchMate.Domain.Matches.Result<Match> result, string step) =>
        result.IsSuccess && result.Value is not null
            ? result.Value
            : throw new InvalidOperationException($"Seeder step '{step}' failed: {result.Error?.Message}");

    private static SquadMembership Create(PitchMate.Domain.Squads.Result<SquadMembership> result, string step) =>
        result.IsSuccess && result.Value is not null
            ? result.Value
            : throw new InvalidOperationException($"Seeder step '{step}' failed: {result.Error?.Message}");

    private static Squad Create(PitchMate.Domain.Squads.Result<Squad> result, string step) =>
        result.IsSuccess && result.Value is not null
            ? result.Value
            : throw new InvalidOperationException($"Seeder step '{step}' failed: {result.Error?.Message}");

    /// <summary>A built match: the aggregate, its snapshot rows, and the resolved model.</summary>
    private sealed record BuiltMatch(
        Match Match,
        IReadOnlyList<RatingSnapshot> Snapshots,
        SeededStatsDataset.MatchData Data);
}

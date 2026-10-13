using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Matches.Repositories;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Squads.Repositories;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// Materialises a <see cref="MatchListDatasetSpec"/> into a real <see cref="PitchMateDbContext"/> by
/// driving the actual <see cref="Match"/> aggregate through its lifecycle, so the persisted rows the
/// match-list query reads are exactly the rows production writes — the same approach
/// <c>StatsDatasetSeeder</c> takes for the stats reads.
/// <para>
/// Everything is persisted in a single unit of work so the change tracker orders the inserts to
/// satisfy the foreign keys, and the returned <see cref="SeededMatchListDataset"/> carries the
/// aggregates themselves so the test's expectations are read off the aggregate rather than restated.
/// </para>
/// </summary>
internal sealed class MatchListDatasetSeeder
{
    /// <summary>The smallest team a lock admits, mirrored here so the seeder fails fast on a bad spec.</summary>
    private const int MinimumRolledParticipants = Match.TeamMinSize * 2;

    /// <summary>The largest two-team roster a lock admits.</summary>
    private const int MaximumRolledParticipants = Match.TeamMaxSize * 2;

    /// <summary>
    /// Seeds <paramref name="spec"/> into <paramref name="context"/>, returning the resolved dataset.
    /// Soft-deletion of squads and matches is <em>not</em> applied here: it runs as a second unit of
    /// work in <see cref="MatchListSourceHarness"/>, so the production save pipeline reinterprets the
    /// removal of an already-persisted row rather than of a freshly added one.
    /// </summary>
    /// <param name="context">The context to persist into; its clock stamps the audit fields.</param>
    /// <param name="spec">The abstract dataset to materialise.</param>
    /// <param name="anchor">The instant every candidate day and completion instant is offset from.</param>
    /// <param name="cancellationToken">A token to cancel the seeding.</param>
    public async Task<SeededMatchListDataset> SeedAsync(
        PitchMateDbContext context,
        MatchListDatasetSpec spec,
        DateTimeOffset anchor,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(spec);

        var squadRepository = new EfSquadRepository(context);
        var membershipRepository = new EfSquadMembershipRepository(context);
        var matchRepository = new EfMatchRepository(context);

        var seededSquads = new List<SeededMatchListDataset.SquadData>(spec.Squads.Count);

        for (int s = 0; s < spec.Squads.Count; s++)
        {
            MatchListDatasetSpec.SquadSpec squadSpec = spec.Squads[s];

            // A fresh identity and a fresh name per seed, because the harness reuses one database
            // across tests and every earlier test's squad stays behind as another squad whose matches
            // must not contribute to this one's list.
            Squad squad = Unwrap(Squad.Create($"Match list {Guid.NewGuid():N}"), "create squad");
            await squadRepository.AddAsync(squad, cancellationToken);

            var pool = new List<SquadMembership>(squadSpec.MemberCount);
            for (int i = 0; i < squadSpec.MemberCount; i++)
            {
                SquadMembership member = Unwrap(
                    SquadMembership.CreateRegistered(squad.Id, Guid.CreateVersion7(), $"S{s}M{i}"),
                    "create member");
                pool.Add(member);
                await membershipRepository.AddAsync(member, cancellationToken);
            }

            var matches = new List<Match>(squadSpec.Matches.Count);
            var softDeleted = new HashSet<Guid>();

            for (int m = 0; m < squadSpec.Matches.Count; m++)
            {
                MatchListDatasetSpec.MatchSpec matchSpec = squadSpec.Matches[m];
                Match match = BuildMatch(squad, pool, matchSpec, anchor, m);

                await matchRepository.AddAsync(match, cancellationToken);
                matches.Add(match);

                if (matchSpec.SoftDeleted)
                {
                    softDeleted.Add(match.Id);
                }
            }

            seededSquads.Add(new SeededMatchListDataset.SquadData(
                squad.Id, matches, softDeleted, squadSpec.SoftDeleteSquad));
        }

        await new UnitOfWork(context).SaveChangesAsync(cancellationToken);
        return new SeededMatchListDataset(seededSquads);
    }

    /// <summary>
    /// Builds one match to its target lifecycle state through the real aggregate transitions, so the
    /// persisted <c>state</c>, <c>confirmed_day</c>, <c>candidate_days</c>, <c>kickoff_lineup</c>,
    /// <c>recorded_result</c> and <c>completed_at</c> columns hold exactly what production writes.
    /// </summary>
    private static Match BuildMatch(
        Squad squad,
        IReadOnlyList<SquadMembership> pool,
        MatchListDatasetSpec.MatchSpec spec,
        DateTimeOffset anchor,
        int sequence)
    {
        List<DateTimeOffset> candidateDays =
            [.. spec.CandidateDayOffsetDays.Select(offset => anchor.AddDays(offset))];

        Match match = Unwrap(
            Match.CreateDraft(
                Guid.CreateVersion7(),
                squad.Id,
                $"Pitch {sequence}",
                candidateDays,
                anchor),
            "create draft");

        if (spec.State == MatchState.GatheringAvailability)
        {
            if (spec.ParticipantCount != 0)
            {
                throw new InvalidOperationException(
                    "A match that stops at GatheringAvailability can carry no participants: the aggregate admits them only once confirmed.");
            }

            return match;
        }

        // The confirm seeds no participants of its own (no availability responses are stored and no
        // registered members are supplied), so the participant count below is exactly the spec's.
        Check(
            match.Confirm(
                candidateDays[spec.ConfirmedDayIndex],
                availableCount: 0,
                minimumThreshold: 0,
                []),
            "confirm");

        AddParticipants(match, pool, spec.ParticipantCount);

        if (spec.State == MatchState.Confirmed)
        {
            return match;
        }

        if (spec.State == MatchState.Cancelled)
        {
            Check(match.Cancel(), "cancel");
            return match;
        }

        RollAndLockTeams(match, pool, spec.ParticipantCount);

        if (spec.State == MatchState.TeamsRolled)
        {
            return match;
        }

        Check(match.Start(), "start");

        if (spec.State == MatchState.InProgress)
        {
            return match;
        }

        if (spec.State != MatchState.Completed)
        {
            throw new InvalidOperationException($"Unhandled target match state '{spec.State}'.");
        }

        List<MatchTeam> teams = [.. match.Teams];
        List<TeamScore> scores = [.. teams.Select((team, index) => new TeamScore(team.Id, index + 1))];

        Check(
            match.RecordResult(
                new MatchResult(ResultFidelity.Basic, scores),
                squad.IsFeatureEnabled(SquadFeature.LiveMatchTracking)),
            "record result");
        Check(match.Complete(anchor.AddDays(20).AddSeconds(spec.CompletedOffsetSeconds)), "complete");

        return match;
    }

    /// <summary>Adds the first <paramref name="count"/> memberships of the pool as participants.</summary>
    private static void AddParticipants(Match match, IReadOnlyList<SquadMembership> pool, int count)
    {
        if (count > pool.Count)
        {
            throw new InvalidOperationException(
                $"A match wants {count} participants but the squad pool holds {pool.Count}; raise the spec's MemberCount.");
        }

        for (int i = 0; i < count; i++)
        {
            Check(match.AddParticipant(pool[i]), "add participant");
        }
    }

    /// <summary>
    /// Partitions the match's participants into two teams as evenly as the count allows, flags the
    /// second as bib-wearing, and locks — capturing the immutable kickoff lineup whose team names and
    /// bib flags the list read reports.
    /// </summary>
    private static void RollAndLockTeams(Match match, IReadOnlyList<SquadMembership> pool, int count)
    {
        if (count < MinimumRolledParticipants || count > MaximumRolledParticipants)
        {
            throw new InvalidOperationException(
                $"A rolled match needs {MinimumRolledParticipants} to {MaximumRolledParticipants} participants " +
                $"(two teams of {Match.TeamMinSize} to {Match.TeamMaxSize}), but the spec asked for {count}.");
        }

        int first = (count + 1) / 2;
        List<Guid> firstRoster = [.. pool.Take(first).Select(member => member.Id)];
        List<Guid> secondRoster = [.. pool.Skip(first).Take(count - first).Select(member => member.Id)];

        Check(
            match.ApplyTeamProposal(
            [
                new ProposedTeam("Reds", BibFlag: false, firstRoster),
                new ProposedTeam("Bibs", BibFlag: true, secondRoster)
            ]),
            "apply team proposal");
        Check(match.Lock(), "lock");
    }

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

    private static Match Unwrap(PitchMate.Domain.Matches.Result<Match> result, string step) =>
        result.IsSuccess && result.Value is not null
            ? result.Value
            : throw new InvalidOperationException($"Seeder step '{step}' failed: {result.Error?.Message}");

    private static SquadMembership Unwrap(PitchMate.Domain.Squads.Result<SquadMembership> result, string step) =>
        result.IsSuccess && result.Value is not null
            ? result.Value
            : throw new InvalidOperationException($"Seeder step '{step}' failed: {result.Error?.Message}");

    private static Squad Unwrap(PitchMate.Domain.Squads.Result<Squad> result, string step) =>
        result.IsSuccess && result.Value is not null
            ? result.Value
            : throw new InvalidOperationException($"Seeder step '{step}' failed: {result.Error?.Message}");
}

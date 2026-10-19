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
        var availabilityRepository = new EfAvailabilityRepository(context);
        var ratingRepository = new EfMembershipRatingRepository(context);

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

            // The first registered member organises the squad, so the organiser-gated read has a caller.
            if (pool.Count > 0)
            {
                PitchMate.Domain.Squads.Result promoted = pool[0].PromoteToAdmin();
                if (!promoted.IsSuccess)
                {
                    throw new InvalidOperationException($"Seeder step 'promote organiser' failed: {promoted.Error?.Message}");
                }
            }

            var ratings = new Dictionary<Guid, PitchMate.Domain.Rating.Rating>();
            foreach (SquadMembership rated in pool.Take(squadSpec.RatedCount))
            {
                var rating = new PitchMate.Domain.Rating.Rating(20 + ratings.Count, 2 + (ratings.Count % 3));
                ratings[rated.Id] = rating;
                await ratingRepository.AddAsync(MembershipRating.Create(rated.Id, rating), cancellationToken);
            }

            var guests = new List<SquadMembership>(squadSpec.GuestCount);
            for (int i = 0; i < squadSpec.GuestCount; i++)
            {
                SquadMembership guest = Unwrap(
                    SquadMembership.CreateGuest(squad.Id, $"S{s}G{i}", skillTier: null, anchor),
                    "create guest");
                guests.Add(guest);
                await membershipRepository.AddAsync(guest, cancellationToken);
            }

            var matches = new List<Match>(squadSpec.Matches.Count);
            var softDeleted = new HashSet<Guid>();
            var responses = new List<AvailabilityResponse>();

            for (int m = 0; m < squadSpec.Matches.Count; m++)
            {
                MatchListDatasetSpec.MatchSpec matchSpec = squadSpec.Matches[m];
                Match match = BuildMatch(squad, pool, guests, matchSpec, anchor, m, responses);

                await matchRepository.AddAsync(match, cancellationToken);
                matches.Add(match);

                if (matchSpec.SoftDeleted)
                {
                    softDeleted.Add(match.Id);
                }
            }

            // Anonymised after the matches are built, so an anonymised membership can also be a
            // participant — the read must count it all the same.
            foreach (SquadMembership member in pool.TakeLast(squadSpec.AnonymisedCount))
            {
                member.Anonymise();
            }

            foreach (AvailabilityResponse response in responses)
            {
                await availabilityRepository.UpsertAsync(response, cancellationToken);
            }

            seededSquads.Add(new SeededMatchListDataset.SquadData(
                squad.Id, matches, softDeleted, squadSpec.SoftDeleteSquad, [.. pool, .. guests], responses, ratings));
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
        IReadOnlyList<SquadMembership> guests,
        MatchListDatasetSpec.MatchSpec spec,
        DateTimeOffset anchor,
        int sequence,
        List<AvailabilityResponse> responses)
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

        // Responses are stored while the match gathers availability, and outlive the confirm.
        foreach (MatchListDatasetSpec.AvailabilityMark mark in spec.AvailabilityMarks ?? [])
        {
            AvailabilityResponse response = Unwrap(
                match.SubmitAvailability(
                    pool[mark.MemberIndex].Id,
                    [.. mark.MarkedDayIndexes.Select(index => candidateDays[index])],
                    anchor),
                "submit availability");
            responses.Add(response);
        }

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

        List<SquadMembership> participants = AddParticipants(
            match, pool, guests, spec.ParticipantCount, spec.GuestParticipantCount, spec.RemovedParticipantCount);

        if (spec.State == MatchState.Confirmed)
        {
            if (spec.ProposeTeamsWithoutLock)
            {
                ApplyTwoTeamProposal(match, participants);
            }

            if (spec.Teams is { } plan)
            {
                ApplyTeamPlan(match, pool, participants, plan);
            }

            return match;
        }

        if (spec.State == MatchState.Cancelled)
        {
            if (spec.CancelFromRolled)
            {
                RollAndLockTeams(match, participants);
            }

            Check(match.Cancel(), "cancel");
            return match;
        }

        RollAndLockTeams(match, participants);

        if (spec.MoveAfterLock)
        {
            List<MatchTeam> locked = [.. match.Teams];
            Check(match.MoveParticipant(locked[0].Roster[0], locked[1].Id), "move after lock");
        }

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

    /// <summary>
    /// Adds <paramref name="count"/> participants — the first <paramref name="guestCount"/> guests of
    /// the guest pool and the first <c>count - guestCount</c> registered members of the pool — and
    /// returns them in the order they were added. With <paramref name="removedCount"/> further
    /// registered members are added and then removed, leaving gaps in the roster positions.
    /// </summary>
    private static List<SquadMembership> AddParticipants(
        Match match,
        IReadOnlyList<SquadMembership> pool,
        IReadOnlyList<SquadMembership> guests,
        int count,
        int guestCount,
        int removedCount = 0)
    {
        int registeredCount = count - guestCount + removedCount;

        if (guestCount < 0 || guestCount > count || guestCount > guests.Count)
        {
            throw new InvalidOperationException(
                $"A match wants {guestCount} guest participants of {count}, but the squad holds {guests.Count} guests.");
        }

        if (registeredCount > pool.Count)
        {
            throw new InvalidOperationException(
                $"A match wants {registeredCount} registered participants but the squad pool holds {pool.Count}; raise the spec's MemberCount.");
        }

        List<SquadMembership> participants = [.. pool.Take(registeredCount), .. guests.Take(guestCount)];

        foreach (SquadMembership participant in participants)
        {
            Check(match.AddParticipant(participant), "add participant");
        }

        // Remove every other one of the first registered participants, never the last-added, so the
        // surviving roster positions keep gaps rather than being reused by a later addition.
        List<SquadMembership> removed = [.. pool.Take(registeredCount).Where((_, index) => index % 2 == 1).Take(removedCount)];
        if (removed.Count != removedCount)
        {
            throw new InvalidOperationException(
                $"A match wants {removedCount} removals but only {removed.Count} registered participants can leave a gap.");
        }

        foreach (SquadMembership leaving in removed)
        {
            Check(match.RemoveParticipant(leaving.Id), "remove participant");
        }

        return [.. participants.Except(removed)];
    }

    /// <summary>
    /// Applies an unlocked team plan: the proposal (its sizes partitioning the participants in order),
    /// then the moves, then the late additions who sit on no team.
    /// </summary>
    private static void ApplyTeamPlan(
        Match match,
        IReadOnlyList<SquadMembership> pool,
        IReadOnlyList<SquadMembership> participants,
        MatchListDatasetSpec.TeamPlan plan)
    {
        if (plan.Teams.Sum(static team => team.Size) != participants.Count)
        {
            throw new InvalidOperationException(
                $"A team plan's sizes sum to {plan.Teams.Sum(static team => team.Size)} but the match has {participants.Count} participants.");
        }

        var proposal = new List<ProposedTeam>(plan.Teams.Count);
        int taken = 0;
        foreach (MatchListDatasetSpec.PlannedTeam team in plan.Teams)
        {
            proposal.Add(new ProposedTeam(team.Name, team.Bib, [.. participants.Skip(taken).Take(team.Size).Select(static member => member.Id)]));
            taken += team.Size;
        }

        Check(match.ApplyTeamProposal(proposal), "apply team plan");

        List<MatchTeam> teams = [.. match.Teams];
        foreach ((int participant, int toTeam) in plan.Moves)
        {
            Check(match.MoveParticipant(participants[participant].Id, teams[toTeam].Id), "move participant");
        }

        HashSet<Guid> playing = [.. match.Participants.Select(static participant => participant.SquadMembershipId)];
        List<SquadMembership> late = [.. pool.Where(member => !playing.Contains(member.Id)).Take(plan.AddedAfter)];
        if (late.Count != plan.AddedAfter)
        {
            throw new InvalidOperationException($"A team plan wants {plan.AddedAfter} late additions but the pool has {late.Count} spare.");
        }

        foreach (SquadMembership member in late)
        {
            Check(match.AddParticipant(member), "add participant after proposal");
        }
    }

    /// <summary>
    /// Partitions the participants into two teams as evenly as the count allows, flags the second as
    /// bib-wearing, and locks — capturing the immutable kickoff lineup whose team names and bib flags
    /// the list read reports.
    /// </summary>
    private static void RollAndLockTeams(Match match, IReadOnlyList<SquadMembership> participants)
    {
        ApplyTwoTeamProposal(match, participants);
        Check(match.Lock(), "lock");
    }

    /// <summary>
    /// Applies a two-team proposal over the participants without locking it, so the match holds
    /// working teams but no kickoff lineup.
    /// </summary>
    private static void ApplyTwoTeamProposal(Match match, IReadOnlyList<SquadMembership> participants)
    {
        int count = participants.Count;

        if (count < MinimumRolledParticipants || count > MaximumRolledParticipants)
        {
            throw new InvalidOperationException(
                $"Two teams need {MinimumRolledParticipants} to {MaximumRolledParticipants} participants " +
                $"(two teams of {Match.TeamMinSize} to {Match.TeamMaxSize}), but the spec asked for {count}.");
        }

        int first = (count + 1) / 2;
        List<Guid> firstRoster = [.. participants.Take(first).Select(member => member.Id)];
        List<Guid> secondRoster = [.. participants.Skip(first).Select(member => member.Id)];

        Check(
            match.ApplyTeamProposal(
            [
                new ProposedTeam("Reds", BibFlag: false, firstRoster),
                new ProposedTeam("Bibs", BibFlag: true, secondRoster)
            ]),
            "apply team proposal");
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

    private static AvailabilityResponse Unwrap(PitchMate.Domain.Matches.Result<AvailabilityResponse> result, string step) =>
        result.IsSuccess && result.Value is not null
            ? result.Value
            : throw new InvalidOperationException($"Seeder step '{step}' failed: {result.Error?.Message}");

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

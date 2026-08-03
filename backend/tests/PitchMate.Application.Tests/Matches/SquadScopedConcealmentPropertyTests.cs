using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using MatchErrorCode = PitchMate.Domain.Matches.MatchErrorCode;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// Property-based test for squad-scoped concealment across the match read use cases (match-lifecycle
/// design Property 20). For any read use case and any actor, a match and its derived views are
/// visible only to an active member of the match's squad; every other actor — an inactive
/// membership, a non-member, or a genuine member requesting a match that does not exist — receives
/// the single uniform, non-disclosing authorisation failure. Because that failure is byte-identical
/// whether the caller is a non-member or a real member asking for a non-existent match, a rejection
/// never reveals whether the match exists (Requirement 5.5, 5.6, 5.7, 9.4, 9.5, 14.3, 14.4).
/// <para>
/// The test exercises the already-implemented <see cref="GetAvailabilityTallyHandler"/> and
/// <see cref="GetTeamSheetHandler"/> against faked repositories. For each generated squad it builds a
/// squad-scoped match in a state where an active member reads successfully (a gathering-availability
/// match for the tally; a locked <see cref="MatchState.TeamsRolled"/> match for the team sheet), then
/// runs the four actor scenarios and asserts the active member succeeds while the three unauthorised
/// scenarios all return the identical uniform <see cref="MatchErrorCode.Unauthorized"/> failure. The
/// property runs at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class SquadScopedConcealmentPropertyTests
{
    /// <summary>The clock instant matches are drafted against; every candidate/confirmed day is strictly after it.</summary>
    private static readonly DateTimeOffset NowUtc = new(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);

    /// <summary>The two match read use cases whose squad-scoped concealment is asserted.</summary>
    private enum HandlerKind
    {
        AvailabilityTally,
        TeamSheet
    }

    // Feature: match-lifecycle, Property 20: All match access is squad-scoped and conceals existence -
    // for any read use case and any actor, a match and its derived views are visible only to an active
    // member of the match's squad; a non-member, an inactive membership, or a request for a
    // non-existent match all receive the same uniform non-disclosing failure that never reveals whether
    // the match exists.
    // Validates: Requirements 5.5, 5.6, 5.7, 9.4, 9.5, 14.3, 14.4
    [Property(MaxTest = 200)]
    [Trait("Property", "20")]
    public Property MatchReadsAreSquadScopedAndConcealExistence() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var squadId = Guid.NewGuid();

            // An active registered member of the match's squad — the only actor that may read.
            var member = SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), "Active Member").Value!;

            // An active membership of the SAME squad but a different backing user, deactivated so it is
            // no longer an active member; it must be concealed just like a non-member (Requirement 14.4).
            var inactive = SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), "Left Member").Value!;
            inactive.Deactivate();

            // Build a squad-scoped match in a state where the active member reads successfully.
            var match = BuildMatch(scenario, squadId);

            var memberships = new ConcealmentMembershipRepository(member, inactive);
            var matches = new ConcealmentMatchRepository(match);
            var availability = new ConcealmentAvailabilityRepository();

            // 1. Active member of the match's squad -> success (the view is returned, subject to state).
            var active = Invoke(scenario.Handler, matches, memberships, availability, member.UserId!.Value, match.Id);

            // 2. An inactive membership of the squad -> uniform non-disclosing failure (Requirement 14.4).
            var inactiveOutcome =
                Invoke(scenario.Handler, matches, memberships, availability, inactive.UserId!.Value, match.Id);

            // 3. A non-member (a user with no membership in the squad) -> uniform non-disclosing failure
            //    (Requirement 5.5, 9.4, 14.3).
            var nonMemberOutcome =
                Invoke(scenario.Handler, matches, memberships, availability, Guid.NewGuid(), match.Id);

            // 4. A GENUINE member requesting a match that does not exist -> uniform non-disclosing failure.
            //    This is the crux of concealment: the failure is indistinguishable from the non-member's,
            //    so a rejection never reveals whether the match exists (Requirement 5.6, 5.7, 9.5, 14.4).
            var missingOutcome =
                Invoke(scenario.Handler, matches, memberships, availability, member.UserId!.Value, Guid.NewGuid());

            // The active member is admitted.
            var memberAdmitted = active.Success;

            // Every unauthorised actor is rejected with the uniform Unauthorized failure.
            var allRejected = IsUniformUnauthorized(inactiveOutcome)
                && IsUniformUnauthorized(nonMemberOutcome)
                && IsUniformUnauthorized(missingOutcome);

            // The three rejections are byte-identical (same code AND message), so a non-member cannot be
            // told apart from a member asking for a non-existent match: existence is concealed.
            var indistinguishable = SameFailure(inactiveOutcome, nonMemberOutcome)
                && SameFailure(nonMemberOutcome, missingOutcome);

            return memberAdmitted && allRejected && indistinguishable;
        });

    /// <summary>The outcome of a read: success, or a failure carrying its error code and message.</summary>
    private readonly record struct Outcome(bool Success, MatchErrorCode? Code, string? Message);

    /// <summary>A failure is uniform-unauthorised when it failed with the <see cref="MatchErrorCode.Unauthorized"/> code.</summary>
    private static bool IsUniformUnauthorized(Outcome outcome) =>
        !outcome.Success && outcome.Code == MatchErrorCode.Unauthorized;

    /// <summary>Two failures are indistinguishable when they share the same error code and message.</summary>
    private static bool SameFailure(Outcome left, Outcome right) =>
        !left.Success && !right.Success && left.Code == right.Code && left.Message == right.Message;

    /// <summary>
    /// Invokes the chosen read handler for <paramref name="requestingUserId"/> against
    /// <paramref name="matchId"/> and normalises the result to an <see cref="Outcome"/>.
    /// </summary>
    private static Outcome Invoke(
        HandlerKind handler,
        IMatchRepository matches,
        ISquadMembershipRepository memberships,
        IAvailabilityRepository availability,
        Guid requestingUserId,
        Guid matchId)
    {
        if (handler == HandlerKind.AvailabilityTally)
        {
            var result = new GetAvailabilityTallyHandler(matches, memberships, availability)
                .HandleAsync(new GetAvailabilityTallyCommand(requestingUserId, matchId), CancellationToken.None)
                .GetAwaiter().GetResult();

            return result.IsSuccess
                ? new Outcome(true, null, null)
                : new Outcome(false, result.Error!.Code, result.Error!.Message);
        }

        var sheet = new GetTeamSheetHandler(matches, memberships)
            .HandleAsync(new GetTeamSheetCommand(requestingUserId, matchId), CancellationToken.None)
            .GetAwaiter().GetResult();

        return sheet.IsSuccess
            ? new Outcome(true, null, null)
            : new Outcome(false, sheet.Error!.Code, sheet.Error!.Message);
    }

    /// <summary>
    /// Builds a squad-scoped match in a state where an active member reads it successfully: a
    /// gathering-availability match (with the member's own response stored) for the tally, and a locked
    /// <see cref="MatchState.TeamsRolled"/> match for the team sheet.
    /// </summary>
    private static Match BuildMatch(Scenario scenario, Guid squadId)
    {
        var day = NowUtc.AddDays(scenario.DayOffsetDays);

        if (scenario.Handler == HandlerKind.AvailabilityTally)
        {
            // A gathering-availability match. The tally handler computes over the availability
            // repository's responses (not the aggregate's), and an empty tally is a valid success — all
            // the concealment property needs is that the active member is admitted while others are not.
            return Match.CreateDraft(Guid.Empty, squadId, scenario.Location, [day], NowUtc).Value!;
        }

        // A locked match: draft -> confirm (empty pool) -> add exactly sizeA + sizeB participants ->
        // partition into two named teams with a single bib team -> lock, leaving it in TeamsRolled so a
        // member's team-sheet read succeeds.
        var match = Match.CreateDraft(Guid.Empty, squadId, scenario.Location, [day], NowUtc).Value!;
        match.Confirm(day, availableCount: 0, minimumThreshold: 0, activeRegisteredMembers: []);

        var participantIds = new List<Guid>(scenario.SizeA + scenario.SizeB);
        for (var i = 0; i < scenario.SizeA + scenario.SizeB; i++)
        {
            var participant = SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), $"Player {i}").Value!;
            match.AddParticipant(participant);
            participantIds.Add(participant.Id);
        }

        var proposal = new List<ProposedTeam>
        {
            new("Reds", BibFlag: true, participantIds.Take(scenario.SizeA).ToList()),
            new("Blues", BibFlag: false, participantIds.Skip(scenario.SizeA).ToList())
        };

        match.ApplyTeamProposal(proposal);
        match.Lock();
        return match;
    }

    // ---- Generators -----------------------------------------------------------------------------

    /// <summary>A generated scenario: which read handler, the two team sizes, the location, and the day offset.</summary>
    private sealed record Scenario(HandlerKind Handler, int SizeA, int SizeB, string Location, int DayOffsetDays);

    /// <summary>
    /// Generates a read handler, two valid team sizes in 5..8 (so both accept and uneven splits such as
    /// 7v6 occur and every lock succeeds), a location from a small pool, and a confirmed-day offset of
    /// 1..14 days.
    /// </summary>
    private static Gen<Scenario> ScenarioGen() =>
        from handler in Gen.Elements(HandlerKind.AvailabilityTally, HandlerKind.TeamSheet)
        from sizeA in Gen.Choose(Match.TeamMinSize, Match.TeamMaxSize)
        from sizeB in Gen.Choose(Match.TeamMinSize, Match.TeamMaxSize)
        from location in Gen.Elements("Community Astro Pitch", "Riverside 3G", "The Cage")
        from dayOffsetDays in Gen.Choose(1, 14)
        select new Scenario(handler, sizeA, sizeB, location, dayOffsetDays);
}

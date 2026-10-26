using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// The <c>Reference_Oracle</c> extended with the match detail projection (match-read-models task 10.9):
/// what <see cref="PitchMate.Infrastructure.Matches.Queries.EfMatchDetailSource"/> and
/// <see cref="GetMatchDetailHandler"/> must answer for a seeded match, read off the aggregates.
/// <para>
/// It <b>reuses the Domain rules</b>: every display name is
/// <see cref="ParticipantDisplayName.Resolve"/> over the captured name and the membership's final
/// state, so the SQL's <c>CASE</c> and the rule are held to the same answer; the participant order is
/// the aggregate's roster positions; and the caller's marked days are the aggregate's own response.
/// </para>
/// </summary>
internal static class MatchDetailReferenceOracle
{
    /// <summary>The projection the detail source must return for <paramref name="match"/>.</summary>
    /// <param name="squad">The seeded squad owning the match.</param>
    /// <param name="match">The aggregate that produced the rows.</param>
    public static MatchDetailProjection Projection(SeededMatchListDataset.SquadData squad, Match match)
    {
        ArgumentNullException.ThrowIfNull(squad);
        ArgumentNullException.ThrowIfNull(match);

        return new MatchDetailProjection(
            match.Id,
            match.SquadId,
            match.State,
            match.Location,
            [.. match.CandidateDays.Select(static day => day.Instant)],
            match.ConfirmedDay?.Instant,
            [.. match.Participants.OrderBy(static participant => participant.RosterPosition).Select(participant => ViewOf(squad, participant))],
            match.RecordedResult is { } result ? new RecordedResultView(result.Fidelity, [.. result.TeamScores]) : null,
            match.State == MatchState.Completed ? match.CompletedAt : null);
    }

    /// <summary>The caller's availability the detail must report for one membership.</summary>
    public static CallerAvailability CallerAvailabilityOf(SeededMatchListDataset.SquadData squad, Guid matchId, Guid membershipId)
    {
        AvailabilityResponse? response = squad.ResponseOf(matchId, membershipId);

        return new CallerAvailability(
            response is not null,
            response is null ? [] : [.. response.MarkedDays.Select(static day => day.Instant)]);
    }

    /// <summary>Asserts a source projection agrees with the oracle's, member by member.</summary>
    public static void AssertAgrees(MatchDetailProjection expected, MatchDetailProjection? actual)
    {
        Assert.NotNull(actual);

        Assert.Equal(expected.MatchId, actual!.MatchId);
        Assert.Equal(expected.SquadId, actual.SquadId);
        Assert.Equal(expected.State, actual.State);
        Assert.Equal(expected.Location, actual.Location);
        Assert.Equal(expected.CandidateDays, actual.CandidateDays);
        Assert.Equal(expected.ConfirmedDay, actual.ConfirmedDay);
        Assert.Equal(expected.Participants, actual.Participants);
        Assert.Equal(expected.CompletedAt, actual.CompletedAt);
        AssertResultAgrees(expected.RecordedResult, actual.RecordedResult);
    }

    /// <summary>
    /// Asserts a handler's detail agrees with the oracle's projection, the caller's availability and the
    /// effective threshold.
    /// </summary>
    public static void AssertAgrees(MatchDetailProjection expected, CallerAvailability expectedCaller, MatchDetail actual)
    {
        ArgumentNullException.ThrowIfNull(actual);

        AssertAgrees(
            expected,
            new MatchDetailProjection(
                actual.MatchId, actual.SquadId, actual.State, actual.Location, actual.CandidateDays,
                actual.ConfirmedDay, actual.Participants, actual.RecordedResult, actual.CompletedAt));

        Assert.Equal(actual.Participants.Count, actual.ParticipantCount);
        Assert.Equal(expectedCaller.HasStoredResponse, actual.CallerAvailability.HasStoredResponse);
        Assert.Equal(expectedCaller.MarkedDays.Order(), actual.CallerAvailability.MarkedDays.Order());
    }

    /// <summary>One participant view, its display name resolved by the Domain rule.</summary>
    private static ParticipantView ViewOf(SeededMatchListDataset.SquadData squad, MatchParticipant participant)
    {
        SquadMembership? membership = squad.Memberships.SingleOrDefault(m => m.Id == participant.SquadMembershipId);

        return new ParticipantView(
            participant.SquadMembershipId,
            ParticipantDisplayName.Resolve(
                participant.DisplayName,
                membershipResolved: membership is not null,
                isAnonymised: membership?.DisplayNameNormalized is null),
            participant.IsGuest,
            participant.RosterPosition);
    }

    private static void AssertResultAgrees(RecordedResultView? expected, RecordedResultView? actual)
    {
        if (expected is null)
        {
            Assert.Null(actual);
            return;
        }

        Assert.NotNull(actual);
        Assert.Equal(expected.Fidelity, actual!.Fidelity);
        Assert.Equal(expected.TeamScores, actual.TeamScores);
    }
}

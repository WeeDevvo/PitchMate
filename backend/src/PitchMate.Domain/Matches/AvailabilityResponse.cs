using PitchMate.Domain.Common;

namespace PitchMate.Domain.Matches;

/// <summary>
/// A registered, active squad membership's marking, for a single <see cref="Match"/> while it is
/// in <see cref="MatchState.GatheringAvailability"/>, of the subset of the match's candidate days on
/// which that member is available (Requirement 4.1). A member holds at most one response per match:
/// resubmitting replaces the prior response, and clearing removes it entirely (Requirement 4.2, 4.3).
/// <para>
/// The response is identified within a match by its <see cref="SquadMembershipId"/>, giving the
/// one-response-per-<c>(MatchId, SquadMembershipId)</c> invariant. Its <see cref="MarkedDays"/> subset
/// may be empty: a stored response that marks no candidate day is deliberately distinct from the
/// member having no stored response at all (Requirement 4.7). <see cref="SubmittedAt"/> records the
/// submission instant used later to resolve a member's most recent response for the availability tally
/// (Requirement 5.3).
/// </para>
/// <para>
/// Deriving from <see cref="BaseEntity"/> supplies the GUID v7 key, audit fields, and soft-delete
/// state. The type uses only the .NET base class library and existing Domain types, keeping Domain
/// free of framework concerns (Requirement 16.1). Instances are created only by the owning
/// <see cref="Match"/> aggregate, which enforces the state gate and candidate-day validation.
/// </para>
/// </summary>
public sealed class AvailabilityResponse : BaseEntity
{
    private readonly List<CandidateDay> _markedDays = [];

    /// <summary>Parameterless constructor reserved for the persistence layer.</summary>
    private AvailabilityResponse()
    {
    }

    /// <summary>
    /// Creates a response for <paramref name="squadMembershipId"/> against
    /// <paramref name="matchId"/>, marking exactly the supplied <paramref name="markedDays"/> and
    /// recording the <paramref name="submittedAt"/> instant. Called only by the owning
    /// <see cref="Match"/> aggregate once the candidate-day subset has been validated.
    /// </summary>
    /// <param name="matchId">The identity of the match this response belongs to.</param>
    /// <param name="squadMembershipId">The identity of the responding squad membership.</param>
    /// <param name="markedDays">The validated subset of candidate days the member marks as available; may be empty.</param>
    /// <param name="submittedAt">The instant the response was submitted.</param>
    internal AvailabilityResponse(
        Guid matchId,
        Guid squadMembershipId,
        IEnumerable<CandidateDay> markedDays,
        DateTimeOffset submittedAt)
    {
        MatchId = matchId;
        SquadMembershipId = squadMembershipId;
        SubmittedAt = submittedAt;
        _markedDays.AddRange(markedDays);
    }

    /// <summary>The identity of the match this response belongs to.</summary>
    public Guid MatchId { get; private set; }

    /// <summary>The identity of the responding squad membership; unique within a match.</summary>
    public Guid SquadMembershipId { get; private set; }

    /// <summary>The instant at which this response was submitted, used to resolve a member's latest response.</summary>
    public DateTimeOffset SubmittedAt { get; private set; }

    /// <summary>
    /// The distinct subset of the match's candidate days on which the member is available. An empty
    /// collection is a valid, meaningful state (the member is available on none of the days) and is
    /// distinct from the member having no stored response (Requirement 4.7).
    /// </summary>
    public IReadOnlyCollection<CandidateDay> MarkedDays => _markedDays;

    /// <summary>
    /// Indicates whether this response marks <paramref name="day"/> as available.
    /// </summary>
    /// <param name="day">The candidate day to test.</param>
    /// <returns><see langword="true"/> when the response marks <paramref name="day"/>; otherwise <see langword="false"/>.</returns>
    public bool Marks(CandidateDay day) => _markedDays.Contains(day);
}

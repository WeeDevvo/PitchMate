using PitchMate.Domain.Common;

namespace PitchMate.Domain.Matches;

/// <summary>
/// The aggregate root representing a single game within one squad. A match is drafted by an
/// admin with a location and a set of candidate days, then walks the lifecycle
/// <see cref="MatchState.GatheringAvailability"/> → <see cref="MatchState.Confirmed"/> →
/// <see cref="MatchState.TeamsRolled"/> → <see cref="MatchState.InProgress"/> →
/// <see cref="MatchState.Completed"/>, with an admin-initiated <see cref="MatchState.Cancelled"/>
/// terminal state reachable before play.
/// <para>
/// Deriving from <see cref="BaseEntity"/> supplies the GUID v7 key, audit fields, and soft-delete
/// state; a caller-supplied non-empty id is retained to support idempotent client-assigned writes
/// (Requirement 13.1, 1.7). The type uses only the .NET base class library and existing Domain
/// types, keeping Domain free of framework concerns (Requirement 16.1).
/// </para>
/// </summary>
public sealed class Match : BaseEntity
{
    /// <summary>The minimum trimmed length of a match location.</summary>
    public const int LocationMinLength = 1;

    /// <summary>The maximum trimmed length of a match location.</summary>
    public const int LocationMaxLength = 200;

    /// <summary>The minimum number of candidate days a draft may carry.</summary>
    public const int CandidateDayMinCount = 1;

    /// <summary>The maximum number of candidate days a draft may carry.</summary>
    public const int CandidateDayMaxCount = 14;

    private readonly List<CandidateDay> _candidateDays = [];

    /// <summary>Parameterless constructor reserved for the persistence layer.</summary>
    private Match()
    {
        Location = string.Empty;
    }

    private Match(Guid id, Guid squadId, string location, IEnumerable<CandidateDay> candidateDays)
        : base(id)
    {
        SquadId = squadId;
        Location = location;
        State = MatchState.GatheringAvailability;
        _candidateDays.AddRange(candidateDays);
    }

    /// <summary>The identity of the squad that owns this match. Every match belongs to exactly one squad.</summary>
    public Guid SquadId { get; private set; }

    /// <summary>The current lifecycle state of the match.</summary>
    public MatchState State { get; private set; }

    /// <summary>The trimmed, free-text place the match is played (1..200 characters).</summary>
    public string Location { get; private set; }

    /// <summary>The distinct candidate days on which members mark availability while gathering availability.</summary>
    public IReadOnlyCollection<CandidateDay> CandidateDays => _candidateDays;

    /// <summary>
    /// Creates a match draft in <see cref="MatchState.GatheringAvailability"/> for
    /// <paramref name="squadId"/> (Requirement 1.1, 2.2). The draft is created only when every
    /// validation rule holds; on any failure a validation error is returned and no match is
    /// produced. Validation, in order:
    /// <list type="bullet">
    ///   <item>the trimmed <paramref name="location"/> length is 1..200 (Requirement 1.3);</item>
    ///   <item>the candidate-day count is 1..14 (Requirement 1.4);</item>
    ///   <item>the candidate days are distinct by instant (Requirement 1.5);</item>
    ///   <item>every candidate day is strictly after <paramref name="nowUtc"/> (Requirement 1.6).</item>
    /// </list>
    /// On success the match stores the trimmed location and exactly the supplied days as
    /// <see cref="CandidateDay"/> values. A non-empty <paramref name="id"/> is retained for
    /// idempotent creation; <see cref="Guid.Empty"/> auto-generates a GUID v7 (Requirement 13.1).
    /// Audit fields are populated by <see cref="BaseEntity"/> at persistence (Requirement 1.7).
    /// </summary>
    /// <param name="id">The caller-supplied GUID v7 identity, or <see cref="Guid.Empty"/> to auto-generate one.</param>
    /// <param name="squadId">The identity of the owning squad.</param>
    /// <param name="location">The requested match location; leading and trailing whitespace is trimmed.</param>
    /// <param name="candidateDays">The proposed candidate days; must be 1..14, distinct, and strictly future.</param>
    /// <param name="nowUtc">The current instant supplied by the clock, against which future-dating is checked.</param>
    /// <returns>A success carrying the new match, or a validation failure that creates no match.</returns>
    public static Result<Match> CreateDraft(
        Guid id,
        Guid squadId,
        string location,
        IReadOnlyList<DateTimeOffset> candidateDays,
        DateTimeOffset nowUtc)
    {
        var trimmed = location?.Trim() ?? string.Empty;
        if (trimmed.Length < LocationMinLength || trimmed.Length > LocationMaxLength)
        {
            return Result<Match>.Fail(new MatchError(
                MatchErrorCode.ValidationFailed,
                $"Match location must be {LocationMinLength} to {LocationMaxLength} characters after trimming."));
        }

        if (candidateDays is null || candidateDays.Count < CandidateDayMinCount || candidateDays.Count > CandidateDayMaxCount)
        {
            return Result<Match>.Fail(new MatchError(
                MatchErrorCode.ValidationFailed,
                $"A match draft must have {CandidateDayMinCount} to {CandidateDayMaxCount} candidate days."));
        }

        var days = new List<CandidateDay>(candidateDays.Count);
        var seen = new HashSet<CandidateDay>();
        foreach (var day in candidateDays)
        {
            var candidate = new CandidateDay(day);

            if (!seen.Add(candidate))
            {
                return Result<Match>.Fail(new MatchError(
                    MatchErrorCode.ValidationFailed,
                    "Candidate days must be distinct."));
            }

            if (candidate.Instant <= nowUtc)
            {
                return Result<Match>.Fail(new MatchError(
                    MatchErrorCode.ValidationFailed,
                    "Candidate days must be in the future."));
            }

            days.Add(candidate);
        }

        return Result<Match>.Ok(new Match(id, squadId, trimmed, days));
    }
}

using System.Collections.Immutable;

namespace PitchMate.Domain.LiveTracking;

/// <summary>
/// The live and final tally of goals per team (Requirement 6): an immutable map from a working
/// <c>MatchTeam.Id</c> to that team's non-negative count of effective <c>GoalScored</c> events. A team
/// with no effective goals is not required to appear in the map — <see cref="ForTeam"/> reports 0 for
/// it (Requirement 6.4) — and no count is ever negative (Requirement 6.5).
/// <para>
/// The value object is a pure derivation product built by the <c>MatchEventLog</c> projection from the
/// set of effective events; it stores no ordering and depends only on that set.
/// </para>
/// </summary>
public sealed class RunningScore
{
    private readonly ImmutableDictionary<Guid, int> _countsByTeam;

    private RunningScore(ImmutableDictionary<Guid, int> countsByTeam) => _countsByTeam = countsByTeam;

    /// <summary>The per-team goal counts, keyed on the working <c>MatchTeam.Id</c>. Never contains a negative count.</summary>
    public IReadOnlyDictionary<Guid, int> CountsByTeam => _countsByTeam;

    /// <summary>
    /// Creates a running score from <paramref name="countsByTeam"/>, defensively copying it so the
    /// result is immutable. Returns a <see cref="LiveTrackingErrorCode.ValidationFailed"/> failure — never
    /// throwing — if any count is negative, upholding the non-negative invariant (Requirement 6.5).
    /// </summary>
    /// <param name="countsByTeam">The per-team effective-goal counts.</param>
    /// <returns>A successful result with the running score, or a validation failure.</returns>
    public static Result<RunningScore> Create(IReadOnlyDictionary<Guid, int> countsByTeam)
    {
        ArgumentNullException.ThrowIfNull(countsByTeam);

        foreach (var count in countsByTeam.Values)
        {
            if (count < 0)
            {
                return Result<RunningScore>.Fail(new LiveTrackingError(
                    LiveTrackingErrorCode.ValidationFailed,
                    "A running score count must be a whole number greater than or equal to 0."));
            }
        }

        return Result<RunningScore>.Ok(new RunningScore(countsByTeam.ToImmutableDictionary()));
    }

    /// <summary>
    /// Returns the count of effective goals credited to <paramref name="teamId"/>, or 0 when the team
    /// has no effective goals (Requirement 6.4).
    /// </summary>
    /// <param name="teamId">The working <c>MatchTeam.Id</c> to look up.</param>
    /// <returns>The team's non-negative goal count, or 0 when absent.</returns>
    public int ForTeam(Guid teamId) => _countsByTeam.GetValueOrDefault(teamId, 0);
}

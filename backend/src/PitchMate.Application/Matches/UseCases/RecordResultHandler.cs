using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
// PitchMate.Domain.Matches, PitchMate.Domain.Squads, and PitchMate.Domain.Rating each define a
// Result/Result<T> triad. Import only the specific Squads types this handler needs via aliases so
// the unqualified Result/Result<T> keeps binding to the Matches triad.
using Squad = PitchMate.Domain.Squads.Squad;
using SquadFeature = PitchMate.Domain.Squads.SquadFeature;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Records the outcome of a played match while it is in <see cref="MatchState.InProgress"/>
/// (Requirement 11). The handler loads the squad-scoped match, resolves the acting user's membership
/// in that match's squad via <see cref="ISquadMembershipRepository.GetByUserAndSquadAsync"/>, and
/// gates through <see cref="MatchAuthorization.RequireOrganiser"/>, so only an active registered
/// owner or admin may record a result; a match that cannot be found and any non-organiser both yield
/// the single uniform <see cref="MatchErrorCode.Unauthorized"/> failure, disclosing neither the squad
/// nor the match (Requirement 14.1, 14.2, 14.3).
/// <para>
/// It reads whether the match's squad has the <see cref="SquadFeature.LiveMatchTracking"/> feature
/// enabled (an unavailable squad or unset flag reads as disabled) and hands the proposed
/// <see cref="MatchResult"/> together with that flag to <see cref="Match.RecordResult"/>. The
/// aggregate owns every rule: it asserts the <see cref="MatchState.InProgress"/> state gate, accepts a
/// <see cref="ResultFidelity.Basic"/> result always but a <see cref="ResultFidelity.Rich"/> result
/// only when live tracking is enabled — rejecting a rich result otherwise with a
/// <see cref="MatchErrorCode.LiveTrackingDisabled"/> error — and validates each team score's range
/// (0..99), completeness, and team membership, identifying the offending score and storing nothing on
/// failure (Requirement 11.2, 11.3, 11.4, 11.5, 11.6, 11.7). A failed aggregate operation is returned
/// as-is with nothing committed; on success the stored result is committed atomically through
/// <see cref="IUnitOfWork.SaveChangesAsync"/>. Recording a result raises no notification.
/// </para>
/// </summary>
public sealed class RecordResultHandler
{
    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;
    private readonly ISquadRepository _squads;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the match repository it loads the squad-scoped match through, the
    /// membership repository it resolves and gates the acting membership through, the squad repository
    /// it reads the <c>LiveMatchTracking</c> feature flag from, and the unit of work it commits
    /// through.
    /// </summary>
    public RecordResultHandler(
        IMatchRepository matches,
        ISquadMembershipRepository memberships,
        ISquadRepository squads,
        IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(matches);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _matches = matches;
        _memberships = memberships;
        _squads = squads;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Handles a <see cref="RecordResultCommand"/>, returning the match's identity and the accepted
    /// fidelity on success, or a typed <see cref="MatchError"/> — a uniform authorisation failure for
    /// an unfindable match or a non-organiser, or the aggregate's state, fidelity, or score-validation
    /// failure when the result cannot be recorded.
    /// </summary>
    /// <param name="command">The result-recording request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<RecordResultResult>> HandleAsync(
        RecordResultCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        if (command.ActingUserId == Guid.Empty)
        {
            return Fail(MatchErrorCode.ValidationFailed, "An acting user identifier is required.");
        }

        if (command.MatchId == Guid.Empty)
        {
            return Fail(MatchErrorCode.ValidationFailed, "A match identifier is required.");
        }

        // Load the squad-scoped match first, then gate against its squad. A missing match yields the
        // same uniform authorisation failure as an unauthorised actor, so its (non-)existence is never
        // revealed (Requirement 14.1, 14.2, 14.3).
        Match? match = await _matches.GetByIdAsync(command.MatchId, cancellationToken);
        if (match is null)
        {
            return Result<RecordResultResult>.Fail(MatchAuthorization.RequireOrganiser(null).Error!);
        }

        // Only an active registered owner or admin of the match's squad may record a result
        // (Requirement 14.1, 14.2).
        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, match.SquadId, cancellationToken);

        Result gate = MatchAuthorization.RequireOrganiser(acting);
        if (!gate.IsSuccess)
        {
            return Result<RecordResultResult>.Fail(gate.Error!);
        }

        // Determine whether the squad has live match tracking enabled; an unavailable squad or unset
        // flag reads as disabled, so a rich result is only accepted where the feature is on
        // (Requirement 11.4, 11.5).
        Squad? squad = await _squads.GetByIdAsync(match.SquadId, cancellationToken);
        bool liveTrackingEnabled = squad?.IsFeatureEnabled(SquadFeature.LiveMatchTracking) ?? false;

        // Record on the aggregate: it owns the InProgress state gate, the score validation, and the
        // fidelity/feature-flag rule, storing nothing on any failure (Requirement 11.2-11.7).
        var result = new MatchResult(command.Fidelity, command.TeamScores ?? []);
        Result recorded = match.RecordResult(result, liveTrackingEnabled);
        if (!recorded.IsSuccess)
        {
            return Result<RecordResultResult>.Fail(recorded.Error!);
        }

        // Persist the recorded result atomically; recording raises no notification.
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return Result<RecordResultResult>.Ok(new RecordResultResult(match.Id, command.Fidelity));
    }

    private static Result<RecordResultResult> Fail(MatchErrorCode code, string message) =>
        Result<RecordResultResult>.Fail(new MatchError(code, message));
}

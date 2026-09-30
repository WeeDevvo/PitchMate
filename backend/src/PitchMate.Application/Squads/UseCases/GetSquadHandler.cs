using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

// Alias the rating types this handler needs rather than importing PitchMate.Domain.Rating wholesale:
// that namespace declares its own Result<T>, which would be ambiguous with the squad Result<T> used
// throughout this file.
using IRatingEngine = PitchMate.Domain.Rating.IRatingEngine;
using PlayerRating = PitchMate.Domain.Rating.Rating;
using RatingState = PitchMate.Domain.Rating.RatingState;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Returns a squad's data to one of its active members (Requirement 16.1). The handler resolves the
/// requesting user's membership in the target squad and gates the read through
/// <see cref="SquadAuthorization.RequireActive"/>: only an <c>Active</c> member is served. Any other
/// requester — one holding only an inactive membership, or no membership at all — receives the single
/// uniform authorisation failure that discloses no squad data and does not reveal whether the squad
/// exists (Requirement 16.2). A soft-deleted (pending-deletion) squad is treated identically: it is
/// excluded from the read and the same uniform failure is returned, so its existence is never
/// disclosed (Requirement 17.3).
/// <para>
/// Each member view additionally carries the standing signal that makes "never played" and "still
/// settling" distinguishable in the player list (api-response-contracts Requirement 10.1): the
/// appearance count and the rating classification come from a <b>single</b> squad-scoped
/// <see cref="IMembershipStandingSource"/> read, whatever the squad's size (Requirement 10.2), joined
/// onto the membership they belong to by membership identity (Requirement 10.9). The classification is
/// obtained from <see cref="IRatingEngine.GetState"/>, so the provisional threshold is evaluated in
/// exactly one place — the Domain (Requirement 10.3, 11.6) — and neither μ, σ, nor any display number
/// reaches the view (Requirement 10.7).
/// </para>
/// <para>
/// The standing is a decoration, not the content: a membership the standing source does not report
/// reads as <c>Appearances = 0</c> with no rating state (Requirement 10.4), and a standing-source
/// <i>failure</i> degrades every member view to that same shape rather than withholding the membership
/// list (Requirement 10.8).
/// </para>
/// </summary>
public sealed class GetSquadHandler
{
    private static readonly IReadOnlyDictionary<Guid, MembershipStanding> NoStanding =
        new Dictionary<Guid, MembershipStanding>();

    private readonly ISquadRepository _squads;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IMembershipStandingSource _standing;
    private readonly IRatingEngine _ratingEngine;

    /// <summary>
    /// Creates the handler with the squad and membership repositories it reads through, the
    /// squad-scoped standing source that decorates each member view, and the rating engine that
    /// classifies a membership's rating.
    /// </summary>
    /// <param name="squads">The squad repository.</param>
    /// <param name="memberships">The squad-membership repository.</param>
    /// <param name="standing">The one-read-per-squad membership standing source.</param>
    /// <param name="ratingEngine">Classifies a rating via <see cref="IRatingEngine.GetState"/>.</param>
    public GetSquadHandler(
        ISquadRepository squads,
        ISquadMembershipRepository memberships,
        IMembershipStandingSource standing,
        IRatingEngine ratingEngine)
    {
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(standing);
        ArgumentNullException.ThrowIfNull(ratingEngine);

        _squads = squads;
        _memberships = memberships;
        _standing = standing;
        _ratingEngine = ratingEngine;
    }

    /// <summary>
    /// Handles a <see cref="GetSquadCommand"/>, returning the squad's data on success or the uniform
    /// <see cref="SquadErrorCode.Unauthorized"/> failure when the requester is not an active member
    /// (or the squad is absent / pending deletion).
    /// </summary>
    /// <param name="command">The squad-read request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<SquadData>> HandleAsync(GetSquadCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.RequestingUserId, command.SquadId, cancellationToken);

        // Gate to an active member; a member/inactive/non-member is rejected uniformly (Requirement 16.2).
        Result gate = SquadAuthorization.RequireActive(acting);
        if (!gate.IsSuccess)
        {
            return Result<SquadData>.Fail(gate.Error!);
        }

        // Load the squad, excluding soft-deleted ones. A missing or pending-deletion squad yields the
        // same uniform failure so its (non-)existence is never revealed (Requirement 16.2, 17.3).
        Squad? squad = await _squads.GetByIdAsync(command.SquadId, cancellationToken);
        if (squad is null)
        {
            return Result<SquadData>.Fail(SquadAuthorization.RequireActive(null).Error!);
        }

        IReadOnlyList<SquadMembership> members =
            await _memberships.ListForSquadAsync(command.SquadId, activeOnly: false, cancellationToken);

        // One squad-scoped standing read regardless of squad size (Requirement 10.2).
        IReadOnlyDictionary<Guid, MembershipStanding> standing =
            await ReadStandingAsync(command.SquadId, cancellationToken);

        var memberViews = members
            .Select(m => ToMemberView(m, standing))
            .ToList();

        var featureViews = squad.Features
            .Select(f => new SquadFeatureView(f.Feature, f.IsEnabled))
            .ToList();

        return Result<SquadData>.Ok(new SquadData(squad.Id, squad.Name, memberViews, featureViews));
    }

    /// <summary>
    /// Reads the squad's per-membership standing. The standing decorates the membership list; it is
    /// never allowed to withhold it, so any failure of the source degrades to "no standing to report"
    /// — the same shape as a squad whose memberships have none (Requirement 10.8). A genuine
    /// cancellation is not a source failure and still propagates.
    /// </summary>
    private async Task<IReadOnlyDictionary<Guid, MembershipStanding>> ReadStandingAsync(
        Guid squadId,
        CancellationToken cancellationToken)
    {
        try
        {
            return await _standing.ListForSquadAsync(squadId, cancellationToken) ?? NoStanding;
        }
        catch (Exception) when (!cancellationToken.IsCancellationRequested)
        {
            return NoStanding;
        }
    }

    /// <summary>
    /// Projects one membership onto its view, joining its own standing by membership identity
    /// (Requirement 10.9). An unreported membership reads as zero appearances and no rating state
    /// (Requirement 10.4); the appearance count is clamped non-negative (Requirement 10.5).
    /// </summary>
    private SquadMemberView ToMemberView(
        SquadMembership membership,
        IReadOnlyDictionary<Guid, MembershipStanding> standing)
    {
        MembershipStanding? own = standing.TryGetValue(membership.Id, out MembershipStanding? found) ? found : null;

        return new SquadMemberView(
            membership.Id,
            membership.DisplayName,
            membership.Role,
            membership.State,
            membership.IsGuest,
            Math.Max(0, own?.Appearances ?? 0),
            Classify(own));
    }

    /// <summary>
    /// Classifies a membership's rating through the Domain rule (Requirement 10.3). Reports
    /// <see langword="null"/> when the membership has no rating (Requirement 10.6) and likewise when
    /// the engine cannot classify what it was given, so an unclassifiable rating degrades the
    /// decoration rather than the squad read (Requirement 10.8).
    /// </summary>
    private RatingState? Classify(MembershipStanding? standing)
    {
        if (standing?.Mu is not double mu || standing.Sigma is not double sigma)
        {
            return null;
        }

        Domain.Rating.Result<RatingState> state = _ratingEngine.GetState(new PlayerRating(mu, sigma));

        return state.IsSuccess ? state.Value : null;
    }
}

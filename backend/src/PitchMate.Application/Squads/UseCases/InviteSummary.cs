using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A single invite as surfaced to an owner or admin in the invite list (Requirement 10.5): its
/// identity, its effective <see cref="InviteState"/> resolved against the clock (so a stored-active
/// invite past its expiry reads as <see cref="InviteState.Expired"/>), its creation audit, and its
/// expiry instant. It deliberately carries <b>no</b> value from which the redeemable secret can be
/// reconstructed — the persisted one-way token hash is never exposed here.
/// </summary>
/// <param name="InviteId">The invite's identity.</param>
/// <param name="State">The invite's effective state resolved against the current clock instant.</param>
/// <param name="CreatedAt">The UTC instant at which the invite was created (creation audit).</param>
/// <param name="CreatedBy">The actor that created the invite, or <see langword="null"/> for a system operation.</param>
/// <param name="ExpiresAt">The invite's expiry instant, or <see langword="null"/> for a non-expiring invite.</param>
public sealed record InviteSummary(
    Guid InviteId,
    InviteState State,
    DateTimeOffset CreatedAt,
    string? CreatedBy,
    DateTimeOffset? ExpiresAt);

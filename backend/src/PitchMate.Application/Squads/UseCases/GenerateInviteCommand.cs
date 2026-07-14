namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by an owner or admin to generate a shareable invite link and short code for their squad
/// (Requirement 10.1). The acting user must hold an active <c>Owner</c> or <c>Admin</c> membership in
/// the target squad (Requirement 10.8).
/// <para>
/// Expiry is expressed by <paramref name="Validity"/> and <paramref name="NonExpiring"/>:
/// when <paramref name="NonExpiring"/> is <see langword="false"/> (the default) the invite expires at
/// the clock instant plus <paramref name="Validity"/>, defaulting to 7 days when
/// <paramref name="Validity"/> is <see langword="null"/> (Requirement 10.2); a supplied
/// <paramref name="Validity"/> must fall within 1 hour to 90 days (Requirement 10.9). When
/// <paramref name="NonExpiring"/> is <see langword="true"/> a non-expiring invite is requested, which
/// is only honoured where configuration permits it and otherwise rejected (Requirement 10.3).
/// </para>
/// </summary>
/// <param name="ActingUserId">The authenticated user generating the invite.</param>
/// <param name="SquadId">The squad the invite grants membership to.</param>
/// <param name="Validity">
/// The requested validity period for an expiring invite, or <see langword="null"/> to apply the
/// 7-day default. Ignored when <paramref name="NonExpiring"/> is <see langword="true"/>.
/// </param>
/// <param name="NonExpiring">
/// When <see langword="true"/>, requests an invite with no expiry, permitted only by configuration.
/// </param>
public sealed record GenerateInviteCommand(
    Guid ActingUserId,
    Guid SquadId,
    TimeSpan? Validity = null,
    bool NonExpiring = false);

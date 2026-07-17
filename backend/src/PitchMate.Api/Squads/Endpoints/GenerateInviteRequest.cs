namespace PitchMate.Api.Squads.Endpoints;

/// <summary>
/// The body of an invite-generation request (Requirement 10). When <paramref name="NonExpiring"/> is
/// <see langword="false"/> (the default) the invite expires at the clock instant plus
/// <paramref name="Validity"/>, defaulting to 7 days when <paramref name="Validity"/> is
/// <see langword="null"/>; a supplied validity must fall within 1 hour to 90 days. When
/// <paramref name="NonExpiring"/> is <see langword="true"/> a non-expiring invite is requested, which
/// is honoured only where configuration permits it. The acting user is resolved from the access token.
/// </summary>
/// <param name="Validity">The requested validity period for an expiring invite, or <see langword="null"/> for the 7-day default.</param>
/// <param name="NonExpiring">When <see langword="true"/>, requests an invite with no expiry.</param>
public sealed record GenerateInviteRequest(TimeSpan? Validity = null, bool NonExpiring = false);

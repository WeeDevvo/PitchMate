namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Configuration governing invite generation, bound from the <c>Squads:Invites</c> configuration
/// section. Lives in the Application layer because the invite use cases consume it directly; the Api
/// binds it at startup following the same convention as the auth options
/// (Requirement 10.3).
/// </summary>
public sealed class InviteOptions
{
    /// <summary>The configuration section these options bind from.</summary>
    public const string SectionName = "Squads:Invites";

    /// <summary>
    /// Whether the system permits generating non-expiring invites (invites with no expiry instant).
    /// Defaults to <see langword="false"/>, so a non-expiring request is rejected with
    /// <see cref="Domain.Squads.SquadErrorCode.ExpiryRequired"/> unless an operator opts in; expiring
    /// requests are always accepted regardless of this setting (Requirement 10.2, 10.3).
    /// </summary>
    public bool AllowNonExpiringInvites { get; init; }
}

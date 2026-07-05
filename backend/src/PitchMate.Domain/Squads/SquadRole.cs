namespace PitchMate.Domain.Squads;

/// <summary>
/// The role a registered membership holds within a squad. Guest memberships have no role.
/// </summary>
public enum SquadRole
{
    /// <summary>The single squad owner; can transfer ownership and delete the squad.</summary>
    Owner = 1,

    /// <summary>An administrator; can manage invites, guests, features, and members.</summary>
    Admin = 2,

    /// <summary>A regular member with no administrative privileges.</summary>
    Member = 3
}

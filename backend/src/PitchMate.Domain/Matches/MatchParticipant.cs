using PitchMate.Domain.Common;

namespace PitchMate.Domain.Matches;

/// <summary>
/// A single squad membership included in a <see cref="Match"/>'s playing pool, backed by either a
/// registered user or a guest. Each participant links the match to one
/// <see cref="SquadMembershipId"/> and captures that membership's <see cref="DisplayName"/> at the
/// time it was added to the match (the display-name-at-time shown on the team sheet), so a later
/// rename does not rewrite history.
/// <para>
/// Registered participants are seeded when a match is confirmed, one per active registered member
/// whose availability response marks the confirmed day (Requirement 6.5); guest participants are
/// added by an admin (Requirement 7.1). The owning <see cref="Match"/> aggregate enforces the
/// no-duplicate invariant, so a given <see cref="SquadMembershipId"/> appears at most once per match
/// (Requirement 7.4).
/// </para>
/// <para>
/// Deriving from <see cref="BaseEntity"/> supplies the GUID v7 key, audit fields, and soft-delete
/// state. The type uses only the .NET base class library and existing Domain types, keeping Domain
/// free of framework concerns (Requirement 16.1). Instances are created only by the owning
/// <see cref="Match"/> aggregate.
/// </para>
/// </summary>
public sealed class MatchParticipant : BaseEntity
{
    /// <summary>Parameterless constructor reserved for the persistence layer.</summary>
    private MatchParticipant()
    {
        DisplayName = string.Empty;
    }

    /// <summary>
    /// Creates a participant linking <paramref name="matchId"/> to
    /// <paramref name="squadMembershipId"/>, capturing the <paramref name="displayName"/> in force at
    /// the time of addition. Called only by the owning <see cref="Match"/> aggregate once the
    /// membership's eligibility has been established by the caller.
    /// </summary>
    /// <param name="matchId">The identity of the match this participant belongs to.</param>
    /// <param name="squadMembershipId">The identity of the squad membership playing; unique within a match.</param>
    /// <param name="displayName">The membership's display name captured at the time of addition.</param>
    /// <param name="isGuest"><see langword="true"/> when the membership is a guest; otherwise <see langword="false"/> for a registered member.</param>
    internal MatchParticipant(Guid matchId, Guid squadMembershipId, string displayName, bool isGuest)
    {
        MatchId = matchId;
        SquadMembershipId = squadMembershipId;
        DisplayName = displayName;
        IsGuest = isGuest;
    }

    /// <summary>The identity of the match this participant belongs to.</summary>
    public Guid MatchId { get; private set; }

    /// <summary>The identity of the participating squad membership; unique within a match (Requirement 7.4).</summary>
    public Guid SquadMembershipId { get; private set; }

    /// <summary>The participating membership's display name captured at the time it was added to the match.</summary>
    public string DisplayName { get; private set; }

    /// <summary><see langword="true"/> when this participant is backed by a guest membership; otherwise <see langword="false"/>.</summary>
    public bool IsGuest { get; private set; }
}

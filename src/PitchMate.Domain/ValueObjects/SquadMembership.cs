namespace PitchMate.Domain.ValueObjects;

/// <summary>
/// Represents a user's membership in a squad with their current rating.
/// Maintains the association between a user, squad, and their ELO rating for that squad.
/// </summary>
public record SquadMembership
{
    public UserId UserId { get; init; }
    public SquadId SquadId { get; init; }
    public EloRating CurrentRating { get; init; }
    public DateTime JoinedAt { get; init; }

    private SquadMembership(UserId userId, SquadId squadId, EloRating currentRating, DateTime joinedAt)
    {
        UserId = userId ?? throw new ArgumentNullException(nameof(userId));
        SquadId = squadId ?? throw new ArgumentNullException(nameof(squadId));
        CurrentRating = currentRating ?? throw new ArgumentNullException(nameof(currentRating));
        JoinedAt = joinedAt;
    }

    public static SquadMembership Create(UserId userId, SquadId squadId, EloRating initialRating)
    {
        return new SquadMembership(userId, squadId, initialRating, DateTime.UtcNow);
    }

    public static SquadMembership Create(UserId userId, SquadId squadId, EloRating initialRating, DateTime joinedAt)
    {
        return new SquadMembership(userId, squadId, initialRating, joinedAt);
    }

    /// <summary>
    /// Updates the rating for this membership, creating a new instance.
    /// </summary>
    public SquadMembership UpdateRating(EloRating newRating)
    {
        if (newRating == null)
            throw new ArgumentNullException(nameof(newRating));

        return this with { CurrentRating = newRating };
    }
}

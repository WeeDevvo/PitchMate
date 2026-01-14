using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Entities;

/// <summary>
/// User aggregate root representing a player in the system.
/// Users can join multiple squads and maintain separate ratings per squad.
/// </summary>
public class User
{
    public UserId Id { get; private set; }
    public Email Email { get; private set; }
    public string? PasswordHash { get; private set; }
    public string? GoogleId { get; private set; }
    public DateTime CreatedAt { get; private set; }

    private readonly List<SquadMembership> _squadMemberships;
    public IReadOnlyCollection<SquadMembership> SquadMemberships => _squadMemberships.AsReadOnly();

    // Private constructor for EF Core
    private User()
    {
        Id = null!;
        Email = null!;
        _squadMemberships = new List<SquadMembership>();
    }

    private User(UserId id, Email email, string? passwordHash, string? googleId, DateTime createdAt)
    {
        Id = id ?? throw new ArgumentNullException(nameof(id));
        Email = email ?? throw new ArgumentNullException(nameof(email));
        PasswordHash = passwordHash;
        GoogleId = googleId;
        CreatedAt = createdAt;
        _squadMemberships = new List<SquadMembership>();
    }

    /// <summary>
    /// Creates a new user with email and password authentication.
    /// </summary>
    public static User CreateWithPassword(Email email, string passwordHash)
    {
        if (email == null)
            throw new ArgumentNullException(nameof(email));
        if (string.IsNullOrWhiteSpace(passwordHash))
            throw new ArgumentException("Password hash cannot be empty.", nameof(passwordHash));

        return new User(
            UserId.NewId(),
            email,
            passwordHash,
            null,
            DateTime.UtcNow);
    }

    /// <summary>
    /// Creates a new user with Google OAuth authentication.
    /// </summary>
    public static User CreateWithGoogle(Email email, string googleId)
    {
        if (email == null)
            throw new ArgumentNullException(nameof(email));
        if (string.IsNullOrWhiteSpace(googleId))
            throw new ArgumentException("Google ID cannot be empty.", nameof(googleId));

        return new User(
            UserId.NewId(),
            email,
            null,
            googleId,
            DateTime.UtcNow);
    }

    /// <summary>
    /// Adds the user to a squad with an initial rating.
    /// </summary>
    public void JoinSquad(SquadId squadId, EloRating initialRating)
    {
        if (squadId == null)
            throw new ArgumentNullException(nameof(squadId));
        if (initialRating == null)
            throw new ArgumentNullException(nameof(initialRating));

        // Check if user is already a member of this squad
        if (_squadMemberships.Any(m => m.SquadId.Equals(squadId)))
        {
            throw new InvalidOperationException($"User is already a member of squad {squadId}.");
        }

        var membership = SquadMembership.Create(Id, squadId, initialRating);
        _squadMemberships.Add(membership);
    }

    /// <summary>
    /// Gets the user's membership for a specific squad.
    /// </summary>
    public SquadMembership GetMembershipForSquad(SquadId squadId)
    {
        if (squadId == null)
            throw new ArgumentNullException(nameof(squadId));

        var membership = _squadMemberships.FirstOrDefault(m => m.SquadId.Equals(squadId));
        
        if (membership == null)
        {
            throw new InvalidOperationException($"User is not a member of squad {squadId}.");
        }

        return membership;
    }

    /// <summary>
    /// Updates the user's rating for a specific squad.
    /// </summary>
    public void UpdateRatingForSquad(SquadId squadId, EloRating newRating)
    {
        if (squadId == null)
            throw new ArgumentNullException(nameof(squadId));
        if (newRating == null)
            throw new ArgumentNullException(nameof(newRating));

        var membershipIndex = _squadMemberships.FindIndex(m => m.SquadId.Equals(squadId));
        
        if (membershipIndex == -1)
        {
            throw new InvalidOperationException($"User is not a member of squad {squadId}.");
        }

        var updatedMembership = _squadMemberships[membershipIndex].UpdateRating(newRating);
        _squadMemberships[membershipIndex] = updatedMembership;
    }
}

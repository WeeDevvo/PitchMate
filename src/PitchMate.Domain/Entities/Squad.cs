using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Entities;

/// <summary>
/// Squad aggregate root representing a group of users who organize matches together.
/// Squads maintain their own member list with separate ELO ratings and admin privileges.
/// </summary>
public class Squad
{
    public SquadId Id { get; private set; }
    public string Name { get; private set; }
    public DateTime CreatedAt { get; private set; }

    private readonly List<UserId> _adminIds;
    public IReadOnlyCollection<UserId> AdminIds => _adminIds.AsReadOnly();

    private readonly List<SquadMembership> _members;
    public IReadOnlyCollection<SquadMembership> Members => _members.AsReadOnly();

    // Private constructor for EF Core
    private Squad()
    {
        Id = null!;
        Name = null!;
        _adminIds = new List<UserId>();
        _members = new List<SquadMembership>();
    }

    private Squad(SquadId id, string name, UserId creatorId, DateTime createdAt)
    {
        Id = id ?? throw new ArgumentNullException(nameof(id));
        Name = name ?? throw new ArgumentNullException(nameof(name));
        CreatedAt = createdAt;
        _adminIds = new List<UserId> { creatorId ?? throw new ArgumentNullException(nameof(creatorId)) };
        _members = new List<SquadMembership>();
    }

    /// <summary>
    /// Creates a new squad with the creator as the initial admin.
    /// </summary>
    public static Squad Create(string name, UserId creatorId)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new ArgumentException("Squad name cannot be empty.", nameof(name));
        if (creatorId == null)
            throw new ArgumentNullException(nameof(creatorId));

        return new Squad(
            SquadId.NewId(),
            name,
            creatorId,
            DateTime.UtcNow);
    }

    /// <summary>
    /// Adds a user as an admin of the squad.
    /// </summary>
    public void AddAdmin(UserId userId)
    {
        if (userId == null)
            throw new ArgumentNullException(nameof(userId));

        if (_adminIds.Any(id => id.Equals(userId)))
        {
            throw new InvalidOperationException($"User {userId} is already an admin of this squad.");
        }

        _adminIds.Add(userId);
    }

    /// <summary>
    /// Removes a user from the admin list.
    /// </summary>
    public void RemoveAdmin(UserId userId)
    {
        if (userId == null)
            throw new ArgumentNullException(nameof(userId));

        if (!_adminIds.Any(id => id.Equals(userId)))
        {
            throw new InvalidOperationException($"User {userId} is not an admin of this squad.");
        }

        if (_adminIds.Count == 1)
        {
            throw new InvalidOperationException("Cannot remove the last admin from the squad.");
        }

        _adminIds.Remove(userId);
    }

    /// <summary>
    /// Adds a member to the squad with an initial rating.
    /// </summary>
    public void AddMember(UserId userId, EloRating initialRating)
    {
        if (userId == null)
            throw new ArgumentNullException(nameof(userId));
        if (initialRating == null)
            throw new ArgumentNullException(nameof(initialRating));

        if (_members.Any(m => m.UserId.Equals(userId)))
        {
            throw new InvalidOperationException($"User {userId} is already a member of this squad.");
        }

        var membership = SquadMembership.Create(userId, Id, initialRating);
        _members.Add(membership);
    }

    /// <summary>
    /// Removes a member from the squad.
    /// Note: This preserves the historical rating data in the membership record.
    /// </summary>
    public void RemoveMember(UserId userId)
    {
        if (userId == null)
            throw new ArgumentNullException(nameof(userId));

        var membership = _members.FirstOrDefault(m => m.UserId.Equals(userId));
        
        if (membership == null)
        {
            throw new InvalidOperationException($"User {userId} is not a member of this squad.");
        }

        _members.Remove(membership);
    }

    /// <summary>
    /// Checks if a user is an admin of the squad.
    /// </summary>
    public bool IsAdmin(UserId userId)
    {
        if (userId == null)
            throw new ArgumentNullException(nameof(userId));

        return _adminIds.Any(id => id.Equals(userId));
    }

    /// <summary>
    /// Checks if a user is a member of the squad.
    /// </summary>
    public bool IsMember(UserId userId)
    {
        if (userId == null)
            throw new ArgumentNullException(nameof(userId));

        return _members.Any(m => m.UserId.Equals(userId));
    }

    /// <summary>
    /// Gets the membership record for a specific user.
    /// </summary>
    public SquadMembership GetMembershipForUser(UserId userId)
    {
        if (userId == null)
            throw new ArgumentNullException(nameof(userId));

        var membership = _members.FirstOrDefault(m => m.UserId.Equals(userId));
        
        if (membership == null)
        {
            throw new InvalidOperationException($"User {userId} is not a member of this squad.");
        }

        return membership;
    }

    /// <summary>
    /// Updates the rating for a specific member.
    /// </summary>
    public void UpdateMemberRating(UserId userId, EloRating newRating)
    {
        if (userId == null)
            throw new ArgumentNullException(nameof(userId));
        if (newRating == null)
            throw new ArgumentNullException(nameof(newRating));

        var membershipIndex = _members.FindIndex(m => m.UserId.Equals(userId));
        
        if (membershipIndex == -1)
        {
            throw new InvalidOperationException($"User {userId} is not a member of this squad.");
        }

        var updatedMembership = _members[membershipIndex].UpdateRating(newRating);
        _members[membershipIndex] = updatedMembership;
    }
}

using PitchMate.Domain.Common;

namespace PitchMate.Domain.Squads;

/// <summary>
/// A friend group: the container at the heart of PitchMate that owns memberships, invites,
/// per-squad feature flags, and squad-scoped state. A squad has a human-readable name, exactly
/// one owner (via its memberships), and a soft-delete + grace-period lifecycle before purge.
/// <para>
/// Every optional <see cref="SquadFeature"/> is initialised disabled at creation
/// (Requirement 1.3, 13.3); the trimmed name is validated to 1..80 characters (Requirement 1.1,
/// 1.2). Deriving from <see cref="BaseEntity"/> supplies the GUID v7 key, audit fields, and
/// soft-delete state (Requirement 19.5).
/// </para>
/// </summary>
public sealed class Squad : BaseEntity
{
    /// <summary>The minimum trimmed length of a squad name.</summary>
    public const int NameMinLength = 1;

    /// <summary>The maximum trimmed length of a squad name.</summary>
    public const int NameMaxLength = 80;

    /// <summary>The minimum grace period, in whole days, before a soft-deleted squad is purged.</summary>
    public const int GracePeriodMinDays = 1;

    /// <summary>The maximum grace period, in whole days, before a soft-deleted squad is purged.</summary>
    public const int GracePeriodMaxDays = 90;

    /// <summary>The default grace period, in whole days, applied when none is supplied.</summary>
    public const int DefaultGracePeriodDays = 30;

    private readonly List<SquadFeatureFlag> _features = [];
    private readonly List<SquadMembership> _memberships = [];

    /// <summary>Parameterless constructor reserved for the persistence layer.</summary>
    private Squad()
    {
        Name = string.Empty;
    }

    private Squad(string name)
    {
        Name = name;

        // Initialise exactly one flag per defined feature, all disabled (Requirement 1.3, 13.1, 13.3).
        foreach (var feature in Enum.GetValues<SquadFeature>())
        {
            _features.Add(new SquadFeatureFlag(feature));
        }
    }

    /// <summary>The trimmed, human-readable squad name (1..80 characters).</summary>
    public string Name { get; private set; }

    /// <summary>
    /// The UTC instant at which a soft-deleted squad becomes eligible for purge, or
    /// <see langword="null"/> when the squad is not pending deletion (Requirement 17.1).
    /// </summary>
    public DateTimeOffset? PurgeAt { get; private set; }

    /// <summary>The per-feature enabled/disabled flags, one per <see cref="SquadFeature"/> member.</summary>
    public IReadOnlyCollection<SquadFeatureFlag> Features => _features;

    /// <summary>The memberships owned by this squad.</summary>
    public IReadOnlyCollection<SquadMembership> Memberships => _memberships;

    /// <summary>
    /// Whether the squad is pending deletion. Reflects the <see cref="BaseEntity.IsDeleted"/>
    /// soft-delete flag, which the persistence layer manages (Requirement 17.1, 17.3).
    /// </summary>
    public bool IsPendingDeletion => IsDeleted;

    /// <summary>
    /// Creates a squad with a trimmed 1..80 character name and every <see cref="SquadFeature"/>
    /// initialised disabled (Requirement 1.1, 1.3, 13.3). A name whose trimmed length is 0 or
    /// exceeds 80 characters is rejected with <see cref="SquadErrorCode.ValidationFailed"/> and
    /// creates no squad (Requirement 1.2).
    /// </summary>
    /// <param name="name">The requested squad name; leading and trailing whitespace is trimmed.</param>
    /// <returns>A success carrying the new squad, or a validation failure.</returns>
    public static Result<Squad> Create(string name)
    {
        var trimmed = name?.Trim() ?? string.Empty;
        if (trimmed.Length < NameMinLength || trimmed.Length > NameMaxLength)
        {
            return Result<Squad>.Fail(new SquadError(
                SquadErrorCode.ValidationFailed,
                $"Squad name must be {NameMinLength} to {NameMaxLength} characters after trimming."));
        }

        return Result<Squad>.Ok(new Squad(trimmed));
    }

    /// <summary>
    /// Sets the enabled state of a single feature to <paramref name="enabled"/>, regardless of its
    /// prior value, leaving every other feature's state unchanged (Requirement 13.2).
    /// </summary>
    /// <param name="feature">The feature to enable or disable.</param>
    /// <param name="enabled">The requested enabled state.</param>
    public void SetFeature(SquadFeature feature, bool enabled)
    {
        var flag = _features.Find(f => f.Feature == feature);
        if (flag is null)
        {
            _features.Add(new SquadFeatureFlag(feature, enabled));
            return;
        }

        flag.Set(enabled);
    }

    /// <summary>
    /// Returns whether <paramref name="feature"/> is currently enabled for this squad; an
    /// uninitialised feature reads as disabled (Requirement 13.4, 13.5).
    /// </summary>
    /// <param name="feature">The feature to query.</param>
    public bool IsFeatureEnabled(SquadFeature feature)
    {
        var flag = _features.Find(f => f.Feature == feature);
        return flag is not null && flag.IsEnabled;
    }

    /// <summary>
    /// Records the purge instant for a soft-deleted squad (Requirement 17.1). The
    /// <see cref="BaseEntity.IsDeleted"/> soft-delete flag itself is applied by the persistence
    /// layer when the squad is removed within the deleting transaction.
    /// </summary>
    /// <param name="purgeAt">The UTC instant at which the squad becomes eligible for purge.</param>
    public void MarkForDeletion(DateTimeOffset purgeAt) => PurgeAt = purgeAt;

    /// <summary>
    /// Clears the purge instant when a soft-deletion is reversed before purge (Requirement 17.4).
    /// The persistence layer restores the <see cref="BaseEntity.IsDeleted"/> soft-delete flag.
    /// </summary>
    public void CancelDeletion() => PurgeAt = null;
}

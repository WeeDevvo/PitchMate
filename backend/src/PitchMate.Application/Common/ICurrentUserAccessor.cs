namespace PitchMate.Application.Common;

/// <summary>
/// Supplies the identifier of the actor responsible for the current operation, used by
/// the persistence layer to stamp audit fields. A <see langword="null"/> value denotes
/// a system operation with no acting user, which the save pipeline tolerates.
/// <para>Validates: Requirements 6.5 (Application + Domain + BCL types only); see Requirement 2.6.</para>
/// </summary>
public interface ICurrentUserAccessor
{
    /// <summary>
    /// The current actor identifier, or <see langword="null"/> for system operations.
    /// </summary>
    string? CurrentUserId { get; }
}

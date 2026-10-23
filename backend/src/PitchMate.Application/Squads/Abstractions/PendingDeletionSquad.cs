namespace PitchMate.Application.Squads.Abstractions;

/// <summary>
/// One squad its owner has deleted and can still restore: the squad's identity, its name, and the
/// instant it will be purged (Requirement 17.4).
/// </summary>
/// <param name="SquadId">The squad's identity, which the restore and export routes take.</param>
/// <param name="Name">The squad's name, so the owner can tell which squad it is.</param>
/// <param name="PurgeAt">When the grace period ends and the squad is permanently removed.</param>
public sealed record PendingDeletionSquad(Guid SquadId, string Name, DateTimeOffset PurgeAt);

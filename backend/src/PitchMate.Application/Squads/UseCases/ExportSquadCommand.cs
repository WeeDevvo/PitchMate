namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by a squad owner for a machine-readable export of their squad's data, offered before
/// purge to support the UK GDPR data-portability path (Requirement 17.2). The acting user is
/// identified by their user identity and the target squad; the handler resolves that user's own
/// membership, requires it to be the active owner, and produces the export whether or not the squad is
/// soft-deleted.
/// </summary>
/// <param name="RequestingUserId">The authenticated user requesting the export.</param>
/// <param name="SquadId">The squad to export.</param>
public sealed record ExportSquadCommand(
    Guid RequestingUserId,
    Guid SquadId);

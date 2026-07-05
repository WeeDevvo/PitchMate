namespace PitchMate.Application.Auth.Gdpr;

/// <summary>
/// A request to produce the data-subject export (DSAR) record for the user with the given
/// <paramref name="UserId"/> (Requirement 14.4). The export contains only non-secret auth
/// data; an unknown user produces no record and a typed failure (Requirement 14.8).
/// </summary>
/// <param name="UserId">The identifier of the user whose data is exported.</param>
public sealed record ExportUserDataCommand(Guid UserId);

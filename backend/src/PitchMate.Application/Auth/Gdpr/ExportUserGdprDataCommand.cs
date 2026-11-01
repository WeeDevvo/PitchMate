namespace PitchMate.Application.Auth.Gdpr;

/// <summary>
/// A command requesting a comprehensive data-subject access and portability archive (Articles 15 &amp; 20 UK GDPR).
/// </summary>
/// <param name="UserId">The user identifier whose data is requested.</param>
public sealed record ExportUserGdprDataCommand(Guid UserId);

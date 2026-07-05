namespace PitchMate.Application.Auth.Abstractions;

/// <summary>
/// The result of validating an access token: a <paramref name="Status"/> verdict and, only when
/// <see cref="AccessTokenStatus.Valid"/>, the resolved <paramref name="UserId"/> subject. The user id
/// is null for every non-valid outcome.
/// </summary>
/// <param name="Status">The validation verdict.</param>
/// <param name="UserId">The subject user id when valid; otherwise null.</param>
public sealed record AccessTokenValidation(AccessTokenStatus Status, Guid? UserId);

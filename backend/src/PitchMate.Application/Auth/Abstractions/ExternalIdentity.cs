using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.Abstractions;

/// <summary>
/// A verified federated identity projected from a provider assertion. Resolution is keyed solely on
/// (<paramref name="Provider"/>, <paramref name="ProviderUserId"/>) and never on email, so
/// <paramref name="Email"/> and <paramref name="EmailVerified"/> are informational only and never used
/// to merge accounts (Requirements 7.6, 1.4).
/// </summary>
/// <param name="Provider">The verifying provider.</param>
/// <param name="ProviderUserId">The provider's stable subject identifier for the user.</param>
/// <param name="Email">The asserted email, when present.</param>
/// <param name="EmailVerified">Whether the provider asserts the email is verified.</param>
public sealed record ExternalIdentity(
    AuthProvider Provider, string ProviderUserId, string? Email, bool EmailVerified);

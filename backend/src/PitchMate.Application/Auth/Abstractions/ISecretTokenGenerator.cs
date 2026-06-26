namespace PitchMate.Application.Auth.Abstractions;

/// <summary>
/// Generates opaque, single-use secret tokens for email verification and password reset. Each token
/// carries 256 bits of cryptographically secure entropy in a URL-safe encoding so it can travel in a
/// link without escaping. Implemented in Infrastructure (Requirements 4.7, 5.9, 12.2).
/// </summary>
public interface ISecretTokenGenerator
{
    /// <summary>Generates a fresh 256-bit, URL-safe secret token.</summary>
    string Generate();
}

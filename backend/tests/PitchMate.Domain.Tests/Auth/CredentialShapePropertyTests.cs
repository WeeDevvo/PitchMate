using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Auth;

namespace PitchMate.Domain.Tests.Auth;

/// <summary>
/// Property-based tests for the credential-shape invariant on <see cref="AuthIdentity"/>
/// (auth-and-identity design Property 12). A password credential is present if and only if the
/// provider is <see cref="AuthProvider.Password"/>: identities built via
/// <see cref="AuthIdentity.ForPassword"/> are Password identities carrying a credential, while
/// identities built via <see cref="AuthIdentity.ForExternal"/> for an external provider carry no
/// credential. Each property runs at least 100 iterations over arbitrary identifiers and secrets.
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class CredentialShapePropertyTests
{
    /// <summary>Letters and digits used to build emails, subjects, and hashes (no whitespace).</summary>
    private static readonly char[] TokenChars =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".ToCharArray();

    // Feature: auth-and-identity, Property 12: Password credential presence is tied to the Password
    // provider - a ForPassword identity has Provider == Password and a non-null Credential.
    // Validates: Requirements 1.7, 1.8
    [Property(MaxTest = 100)]
    [Trait("Property", "12")]
    public Property PasswordIdentityHasCredential() =>
        Prop.ForAll(Arb.From(PasswordInputGen()), input =>
        {
            var credential = PasswordCredential.Create(input.Hash);
            var identity = AuthIdentity.ForPassword(input.UserId, input.Email, credential);

            return identity.Provider == AuthProvider.Password
                && identity.Credential is not null;
        });

    // Feature: auth-and-identity, Property 12: Password credential presence is tied to the Password
    // provider - an external identity has a non-Password provider and no Credential.
    // Validates: Requirements 1.7, 1.8
    [Property(MaxTest = 100)]
    [Trait("Property", "12")]
    public Property ExternalIdentityHasNoCredential() =>
        Prop.ForAll(Arb.From(ExternalInputGen()), input =>
        {
            var identity = AuthIdentity.ForExternal(input.UserId, input.Provider, input.ProviderUserId);

            return identity.Provider != AuthProvider.Password
                && identity.Credential is null;
        });

    /// <summary>Inputs for building a Password identity.</summary>
    private sealed record PasswordInput(Guid UserId, string Email, string Hash);

    /// <summary>Inputs for building an external identity.</summary>
    private sealed record ExternalInput(Guid UserId, AuthProvider Provider, string ProviderUserId);

    /// <summary>Generates arbitrary inputs for a Password identity.</summary>
    private static Gen<PasswordInput> PasswordInputGen() =>
        from userId in GuidGen()
        from email in TokenGen()
        from hash in TokenGen()
        select new PasswordInput(userId, email, hash);

    /// <summary>Generates arbitrary inputs for an external identity over the external providers.</summary>
    private static Gen<ExternalInput> ExternalInputGen() =>
        from userId in GuidGen()
        from provider in Gen.Elements(AuthProvider.Google, AuthProvider.Apple)
        from providerUserId in TokenGen()
        select new ExternalInput(userId, provider, providerUserId);

    /// <summary>Generates a non-empty, non-whitespace token of letters and digits.</summary>
    private static Gen<string> TokenGen() =>
        from chars in Gen.ListOf(Gen.Elements(TokenChars))
        select "a" + new string(chars.ToArray());

    /// <summary>Generates a fresh arbitrary GUID per sample.</summary>
    private static Gen<Guid> GuidGen() => Gen.Constant(0).Select(_ => Guid.NewGuid());
}

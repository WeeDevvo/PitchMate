using PitchMate.Domain.Auth;

namespace PitchMate.Api.Tests.Auth.Startup;

/// <summary>
/// Smoke test for the closed <see cref="AuthProvider"/> set. The MVP ships <c>Password</c> and
/// <c>Google</c>, and reserves <c>Apple</c> as a future member so the iOS app can adopt Apple
/// Sign-In later without any <c>AuthIdentity</c> schema change. The numeric values are persisted,
/// so they are asserted to be stable.
/// <para>Validates: Requirement 1.6.</para>
/// </summary>
public sealed class AuthProviderEnumSmokeTests
{
    // Requirement 1.6 — Password and Google are defined with their stable persisted values.
    [Fact]
    public void DefinesPasswordAndGoogleWithStableValues()
    {
        Assert.True(Enum.IsDefined(AuthProvider.Password));
        Assert.True(Enum.IsDefined(AuthProvider.Google));

        Assert.Equal(1, (int)AuthProvider.Password);
        Assert.Equal(2, (int)AuthProvider.Google);
    }

    // Requirement 1.6 — Apple is reserved as a future member with a stable value.
    [Fact]
    public void ReservesAppleAsAFutureMember()
    {
        Assert.True(Enum.IsDefined(AuthProvider.Apple));
        Assert.Equal(3, (int)AuthProvider.Apple);
    }

    // Requirement 1.6 — the set is exactly these three members (nothing else has crept in).
    [Fact]
    public void DefinesExactlyPasswordGoogleAndApple()
    {
        string[] names = Enum.GetNames<AuthProvider>();

        Assert.Equal(
            new[] { nameof(AuthProvider.Password), nameof(AuthProvider.Google), nameof(AuthProvider.Apple) }
                .OrderBy(n => n, StringComparer.Ordinal),
            names.OrderBy(n => n, StringComparer.Ordinal));
    }
}

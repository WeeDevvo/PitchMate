namespace PitchMate.Api.Tests.Auth;

/// <summary>
/// The fixed, valid <c>Auth</c> configuration the in-memory Api boots with for the authenticated
/// request-enforcement integration tests, together with the fixed clock instant the injected
/// <c>FakeTimeProvider</c> is pinned to. The signing key, issuer, and audience are shared with the
/// test's token-crafting helper so a token the test forges is judged against exactly the same
/// parameters the running Api's JWT bearer pipeline uses.
/// </summary>
internal static class AuthApiTestConfig
{
    /// <summary>A 32-plus-byte HMAC-SHA256 signing key (the same one the running Api verifies against).</summary>
    public const string SigningKey = "pitchmate-test-signing-key-0123456789-abcdef";

    /// <summary>A second, unrelated 32-plus-byte key used to forge "wrong signing key" tokens.</summary>
    public const string WrongSigningKey = "pitchmate-test-WRONG-key-9876543210-zyxwvu";

    /// <summary>The issuer stamped on and required of valid access tokens.</summary>
    public const string Issuer = "https://test.pitch-mate.local";

    /// <summary>The audience stamped on and required of valid access tokens.</summary>
    public const string Audience = "pitchmate-test";

    /// <summary>The instant the injected <c>FakeTimeProvider</c> is pinned to for the whole test run.</summary>
    public static readonly DateTimeOffset FixedNow = new(2025, 6, 1, 12, 0, 0, TimeSpan.Zero);

    /// <summary>
    /// The full in-memory configuration supplied to the host: a (never-contacted) connection string
    /// plus every <c>Auth</c> key the startup validators require, so the host boots cleanly and the
    /// JWT bearer pipeline is fully configured.
    /// </summary>
    public static IReadOnlyDictionary<string, string?> Settings { get; } = new Dictionary<string, string?>
    {
        // A protected request is rejected before any handler runs, so the database is never contacted;
        // this connection string only has to let the DbContext be constructed and DI validation pass.
        ["ConnectionStrings:Default"] = "Host=localhost;Port=5432;Database=pitchmate_test;Username=test;Password=test",

        ["Auth:Token:SigningKey"] = SigningKey,
        ["Auth:Token:Issuer"] = Issuer,
        ["Auth:Token:Audience"] = Audience,
        ["Auth:Token:AccessTokenLifetime"] = "00:15:00",
        ["Auth:Token:RefreshTokenLifetime"] = "30.00:00:00",

        ["Auth:Google:ClientId"] = "test-client-id.apps.googleusercontent.com",

        ["Auth:Email:Provider"] = "Console",

        ["Auth:EmailVerification:TokenLifetime"] = "1.00:00:00",

        ["Auth:PasswordReset:TokenLifetime"] = "00:30:00",
        ["Auth:PasswordReset:RateLimitWindow"] = "01:00:00",
        ["Auth:PasswordReset:MaxRequestsPerWindow"] = "5",
    };
}

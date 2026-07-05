using System.Runtime.CompilerServices;
using System.Text.Json;

namespace PitchMate.Api.Tests.Auth.Startup;

/// <summary>
/// Smoke test for the committed <c>appsettings.Example.json</c>. It documents the shape of the
/// <c>Auth</c> configuration for operators, so it must list every required <c>Auth</c> key across all
/// sections, and — because it is committed to source — it must carry only placeholders, never real
/// secret values (the signing key, the ACS connection string, the SendGrid API key).
/// <para>Validates: Requirement 15.6.</para>
/// </summary>
public sealed class ExampleConfigurationSmokeTests
{
    // Every required key under Auth, grouped by section. Presence of each is asserted below.
    private static readonly IReadOnlyDictionary<string, string[]> RequiredKeysBySection =
        new Dictionary<string, string[]>
        {
            ["Token"] = ["SigningKey", "Issuer", "Audience", "AccessTokenLifetime", "RefreshTokenLifetime"],
            ["Google"] = ["ClientId"],
            ["Email"] = ["Provider", "FromAddress", "MaxTransientRetries"],
            ["EmailVerification"] = ["TokenLifetime"],
            ["PasswordReset"] = ["TokenLifetime", "RateLimitWindow", "MaxRequestsPerWindow"],
            ["SignInProtection"] = ["RequireVerifiedEmail", "LockoutEnabled", "MaxFailedAttempts", "LockoutWindow"],
        };

    // The secret-bearing string keys that must never hold a real value in committed config. Each is a
    // (section, key) pair under Auth.
    private static readonly (string Section, string Key)[] SecretKeys =
    [
        ("Token", "SigningKey"),
        ("Email", "AcsConnectionString"),
        ("Email", "SendGridApiKey"),
    ];

    // Requirement 15.6 — the example lists every required Auth key across all sections.
    [Fact]
    public void ExampleListsEveryRequiredAuthKey()
    {
        using JsonDocument document = LoadExample();
        JsonElement auth = GetAuthSection(document);

        foreach ((string section, string[] keys) in RequiredKeysBySection)
        {
            Assert.True(
                auth.TryGetProperty(section, out JsonElement sectionElement),
                $"appsettings.Example.json is missing the 'Auth:{section}' section.");

            foreach (string key in keys)
            {
                Assert.True(
                    sectionElement.TryGetProperty(key, out _),
                    $"appsettings.Example.json is missing the required key 'Auth:{section}:{key}'.");
            }
        }
    }

    // Requirement 15.6 — the committed example carries only placeholders, no real secrets.
    [Fact]
    public void ExampleContainsNoRealSecrets()
    {
        using JsonDocument document = LoadExample();
        JsonElement auth = GetAuthSection(document);

        foreach ((string section, string key) in SecretKeys)
        {
            Assert.True(auth.TryGetProperty(section, out JsonElement sectionElement));
            Assert.True(
                sectionElement.TryGetProperty(key, out JsonElement secret),
                $"Expected the secret key 'Auth:{section}:{key}' to be present as a placeholder.");

            string value = secret.GetString() ?? "";

            // A placeholder is wrapped in angle brackets (e.g. "<32-plus-byte-random-secret; ...>");
            // a real secret would not be. This keeps committed config safe to share.
            Assert.True(
                value.StartsWith('<') && value.EndsWith('>'),
                $"'Auth:{section}:{key}' must be an angle-bracketed placeholder, not a real secret.");
        }
    }

    /// <summary>
    /// Loads the committed <c>appsettings.Example.json</c> from the Api project source, located
    /// relative to this test's own source file so the lookup is independent of the runtime working
    /// directory and of whether the file is copied to the test output.
    /// </summary>
    private static JsonDocument LoadExample([CallerFilePath] string testFilePath = "")
    {
        // testFilePath: <repo>/backend/tests/PitchMate.Api.Tests/Auth/Startup/ExampleConfigurationSmokeTests.cs
        DirectoryInfo backend = Directory.GetParent(testFilePath)! // Startup
            .Parent! // Auth
            .Parent! // PitchMate.Api.Tests
            .Parent! // tests
            .Parent!; // backend

        string examplePath = Path.Combine(
            backend.FullName, "src", "PitchMate.Api", "appsettings.Example.json");

        Assert.True(File.Exists(examplePath), $"Could not find appsettings.Example.json at '{examplePath}'.");

        return JsonDocument.Parse(File.ReadAllText(examplePath));
    }

    private static JsonElement GetAuthSection(JsonDocument document)
    {
        Assert.True(
            document.RootElement.TryGetProperty("Auth", out JsonElement auth),
            "appsettings.Example.json is missing the top-level 'Auth' section.");
        return auth;
    }
}

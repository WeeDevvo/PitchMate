using System.Net;
using System.Net.Http;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;

namespace PitchMate.Api.Tests.Auth;

/// <summary>
/// Integration test for Property 34 — <b>Unauthenticated rejections are uniform</b>. It boots the real
/// Api in-memory with a <see cref="FakeTimeProvider"/> and drives a protected endpoint with access
/// tokens that fail authentication for every distinct cause (absent, expired, malformed, tampered, and
/// wrong-key). The property asserts that the resulting <c>401</c> response is byte-for-byte identical
/// across all causes — same status, content type, and body — so the response discloses nothing about
/// which check failed (Requirement 13.5).
/// <para>
/// A rejected request never reaches the protected handler, so it also mutates no state (Requirements
/// 13.3, 13.4); here we can only observe the outward response, which the underlying no-op handler path
/// and the middleware short-circuit guarantee.
/// </para>
/// </summary>
public sealed class UniformUnauthenticatedResponseProperties : IClassFixture<AuthApiFactory>
{
    // A protected endpoint (RequireAuthorization) with no request body — the simplest surface on which
    // to observe the uniform unauthenticated response.
    private const string ProtectedRoute = "/auth/export";

    private readonly HttpClient _client;

    // The reference response captured from the "no token" cause; every other cause must match it.
    private readonly ResponseSnapshot _reference;

    public UniformUnauthenticatedResponseProperties(AuthApiFactory factory)
    {
        ArgumentNullException.ThrowIfNull(factory);
        _client = factory.CreateClient();
        _reference = Capture(RejectionCause.Missing, Guid.Empty, malformedToken: string.Empty);
    }

    // Feature: auth-and-identity, Property 34: Unauthenticated rejections are uniform.
    // Validates: Requirements 13.5
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(UnauthenticatedScenarioGenerators) })]
    public Property Property34_UnauthenticatedRejectionsAreUniform(UnauthenticatedScenario scenario)
    {
        ResponseSnapshot actual = Capture(scenario.Cause, scenario.Subject, scenario.MalformedToken);

        // Every cause yields a 401 whose status, content type, and body are identical to the reference,
        // so no cause is distinguishable from another.
        bool isUnauthorized = actual.Status == (int)HttpStatusCode.Unauthorized;
        bool matchesReference = actual == _reference;

        return (isUnauthorized && matchesReference)
            .ToProperty()
            .Classify(scenario.Cause == RejectionCause.Missing, "missing")
            .Classify(scenario.Cause == RejectionCause.Expired, "expired")
            .Classify(scenario.Cause == RejectionCause.Malformed, "malformed")
            .Classify(scenario.Cause == RejectionCause.Tampered, "tampered")
            .Classify(scenario.Cause == RejectionCause.WrongKey, "wrong-key");
    }

    // Concrete per-cause coverage complementing the property: each individual failure cause returns a
    // 401 identical to the missing-token baseline.
    [Theory]
    [InlineData(RejectionCause.Missing)]
    [InlineData(RejectionCause.Expired)]
    [InlineData(RejectionCause.Malformed)]
    [InlineData(RejectionCause.Tampered)]
    [InlineData(RejectionCause.WrongKey)]
    public void EachRejectionCauseReturnsTheIdenticalUnauthenticatedResponse(RejectionCause cause)
    {
        ResponseSnapshot actual = Capture(cause, Guid.NewGuid(), malformedToken: "not-a-jwt.abc.def");

        Assert.Equal((int)HttpStatusCode.Unauthorized, actual.Status);
        Assert.Equal(_reference, actual);
    }

    private ResponseSnapshot Capture(RejectionCause cause, Guid subject, string malformedToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, ProtectedRoute);

        string? bearer = cause switch
        {
            RejectionCause.Missing => null,
            RejectionCause.Expired => TestAccessTokens.ExpiredToken(subject),
            RejectionCause.Malformed => malformedToken,
            RejectionCause.Tampered => TestAccessTokens.TamperedToken(subject),
            RejectionCause.WrongKey => TestAccessTokens.WrongKeyToken(subject),
            _ => throw new ArgumentOutOfRangeException(nameof(cause), cause, "Unhandled rejection cause."),
        };

        if (bearer is not null)
        {
            // Add without validation so a deliberately malformed token can be sent verbatim.
            request.Headers.TryAddWithoutValidation("Authorization", "Bearer " + bearer);
        }

        using HttpResponseMessage response = _client.SendAsync(request).GetAwaiter().GetResult();
        string body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();

        return new ResponseSnapshot(
            (int)response.StatusCode,
            response.Content.Headers.ContentType?.ToString(),
            body);
    }
}

/// <summary>The distinct causes for which an access token is rejected as unauthenticated.</summary>
public enum RejectionCause
{
    /// <summary>No <c>Authorization</c> header at all.</summary>
    Missing,

    /// <summary>A correctly-signed token whose lifetime has elapsed against the pinned clock.</summary>
    Expired,

    /// <summary>A value that is not a well-formed JWT.</summary>
    Malformed,

    /// <summary>A well-formed, unexpired token whose signature has been altered.</summary>
    Tampered,

    /// <summary>A well-formed, unexpired token signed with a key other than the configured one.</summary>
    WrongKey,
}

/// <summary>
/// A single generated case: which rejection cause to exercise, the subject to stamp on any forged
/// token, and a malformed token string used only by the <see cref="RejectionCause.Malformed"/> case.
/// </summary>
public sealed record UnauthenticatedScenario(RejectionCause Cause, Guid Subject, string MalformedToken);

/// <summary>A normalised, value-comparable view of the parts of an HTTP response the property compares.</summary>
public sealed record ResponseSnapshot(int Status, string? ContentType, string Body);

/// <summary>
/// FsCheck arbitraries for <see cref="UnauthenticatedScenario"/>. The cause is drawn uniformly across
/// all five rejection modes; the subject is an arbitrary GUID; and the malformed-token string is a
/// non-empty run of JWT-ish characters (base64url plus dots) that cannot form a validly-signed token.
/// </summary>
public static class UnauthenticatedScenarioGenerators
{
    private static readonly char[] TokenAlphabet =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.".ToCharArray();

    /// <summary>Arbitrary for a single unauthenticated scenario.</summary>
    public static Arbitrary<UnauthenticatedScenario> UnauthenticatedScenario() => Arb.From(ScenarioGen());

    private static Gen<UnauthenticatedScenario> ScenarioGen() =>
        from cause in Gen.Elements(
            RejectionCause.Missing,
            RejectionCause.Expired,
            RejectionCause.Malformed,
            RejectionCause.Tampered,
            RejectionCause.WrongKey)
        from subject in GuidGen()
        from malformed in MalformedTokenGen()
        select new UnauthenticatedScenario(cause, subject, malformed);

    private static Gen<Guid> GuidGen() =>
        from bytes in ListOfLength(16, Gen.Choose(0, 255))
        select new Guid(bytes.Select(b => (byte)b).ToArray());

    private static Gen<string> MalformedTokenGen() =>
        from length in Gen.Choose(1, 40)
        from chars in ListOfLength(length, Gen.Elements(TokenAlphabet))
        select new string(chars.ToArray());

    private static Gen<List<T>> ListOfLength<T>(int length, Gen<T> element)
    {
        if (length <= 0)
        {
            return Gen.Constant(new List<T>());
        }

        return from head in element
               from tail in ListOfLength(length - 1, element)
               select Prepend(head, tail);
    }

    private static List<T> Prepend<T>(T head, List<T> tail)
    {
        var result = new List<T>(tail.Count + 1) { head };
        result.AddRange(tail);
        return result;
    }
}

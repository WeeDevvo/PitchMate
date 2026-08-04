using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using PitchMate.Api.Stats.Endpoints;
using PitchMate.Application.Stats;

namespace PitchMate.Api.Tests.Stats;

/// <summary>
/// Unit tests over <see cref="StatsErrorResults"/> — the single translation seam from an Application
/// <see cref="StatsError"/> to an HTTP result. These assert the existence-concealing mapping from the
/// design's <c>Error Handling</c> section by <b>executing</b> each mapped <see cref="IResult"/>
/// against a real (in-memory) <see cref="HttpContext"/> and inspecting the status code and the bytes
/// actually written to the response body:
/// <list type="bullet">
/// <item><see cref="StatsErrorCode.Unauthorized"/> and <see cref="StatsErrorCode.NotFound"/> produce a
/// <b>byte-for-byte identical</b> <c>404</c> — same status <i>and</i> same serialized body — so a
/// caller cannot distinguish "not an active member" from "does not exist" (Requirements 1.2, 1.6,
/// 3.6).</item>
/// <item><see cref="StatsErrorCode.UnsupportedStatistic"/> maps to <c>400</c> (Requirement 4.7).</item>
/// <item><see cref="StatsErrorCode.ComputationFailed"/> maps to <c>503</c> carrying no partial or
/// stale statistics payload (Requirement 2.6).</item>
/// </list>
/// <para>Validates: Requirements 1.2, 1.6, 3.6, 4.7, 2.6.</para>
/// </summary>
public sealed class StatsErrorResultsTests
{
    private const string DiagnosticMessage = "diagnostic detail only";

    // Requirements 1.2, 1.6, 3.6 — Unauthorized and NotFound must be indistinguishable. Executing both
    // results against a fresh HttpContext and comparing the status code AND the exact response bytes
    // proves identity, not merely that both are 404 with a similar shape. Two differently-worded
    // messages are supplied on purpose: if the mapping ever leaked the error's Code or Message into the
    // body, these bodies would diverge and the assertion would fail.
    [Fact]
    public async Task ToHttpResult_MapsUnauthorizedAndNotFound_ToByteIdentical404()
    {
        (int unauthorizedStatus, byte[] unauthorizedBody) = await ExecuteAsync(
            StatsErrorResults.ToHttpResult(new StatsError(StatsErrorCode.Unauthorized, "requester is not an active member")));

        (int notFoundStatus, byte[] notFoundBody) = await ExecuteAsync(
            StatsErrorResults.ToHttpResult(new StatsError(StatsErrorCode.NotFound, "no such squad or membership")));

        Assert.Equal(StatusCodes.Status404NotFound, unauthorizedStatus);
        Assert.Equal(StatusCodes.Status404NotFound, notFoundStatus);

        // Byte-for-byte identity of the written body is the crux of the non-disclosure guarantee.
        Assert.Equal(unauthorizedBody, notFoundBody);
    }

    // The concealed 404 body must not echo the differing Code or Message of either failure — otherwise
    // the two responses above could only be identical by coincidence of message length. Assert the body
    // contains neither the enum name nor the diagnostic text of either error.
    [Fact]
    public async Task ToHttpResult_ConcealedResponse_LeaksNeitherCodeNorMessage()
    {
        (_, byte[] bodyBytes) = await ExecuteAsync(
            StatsErrorResults.ToHttpResult(new StatsError(StatsErrorCode.Unauthorized, DiagnosticMessage)));

        string body = Encoding.UTF8.GetString(bodyBytes);

        Assert.DoesNotContain(DiagnosticMessage, body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(nameof(StatsErrorCode.Unauthorized), body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(nameof(StatsErrorCode.NotFound), body, StringComparison.OrdinalIgnoreCase);
    }

    // The dedicated Concealed() helper is the single source of the 404 both codes route through, so it
    // must itself produce that same 404 response — guaranteeing the two mapped codes can never drift.
    [Fact]
    public async Task Concealed_ProducesTheSame404_AsTheMappedCodes()
    {
        (int concealedStatus, byte[] concealedBody) = await ExecuteAsync(StatsErrorResults.Concealed());
        (int mappedStatus, byte[] mappedBody) = await ExecuteAsync(
            StatsErrorResults.ToHttpResult(new StatsError(StatsErrorCode.NotFound, DiagnosticMessage)));

        Assert.Equal(StatusCodes.Status404NotFound, concealedStatus);
        Assert.Equal(mappedStatus, concealedStatus);
        Assert.Equal(mappedBody, concealedBody);
    }

    // Requirement 4.7 — an unsupported ranking statistic is a client error, mapped to 400.
    [Fact]
    public async Task ToHttpResult_MapsUnsupportedStatistic_To400()
    {
        (int status, _) = await ExecuteAsync(
            StatsErrorResults.ToHttpResult(new StatsError(StatsErrorCode.UnsupportedStatistic, DiagnosticMessage)));

        Assert.Equal(StatusCodes.Status400BadRequest, status);
    }

    // Requirement 2.6 — a computation failure is answered with 503 and never carries a partial or stale
    // statistics payload. The body is asserted to be a generic ProblemDetails that echoes only the
    // error code/generic message, not any statistics field (e.g. appearances, ratings, leaderboard).
    [Fact]
    public async Task ToHttpResult_MapsComputationFailed_To503_WithNoStatisticsPayload()
    {
        (int status, byte[] bodyBytes) = await ExecuteAsync(
            StatsErrorResults.ToHttpResult(new StatsError(StatsErrorCode.ComputationFailed, DiagnosticMessage)));

        Assert.Equal(StatusCodes.Status503ServiceUnavailable, status);

        string body = Encoding.UTF8.GetString(bodyBytes);
        foreach (string statisticField in new[]
                 {
                     "appearances", "winPercentage", "displayRating", "leaderboard", "entries",
                     "profile", "ratingProgression", "wins", "losses", "draws",
                 })
        {
            Assert.DoesNotContain(statisticField, body, StringComparison.OrdinalIgnoreCase);
        }
    }

    /// <summary>
    /// Executes a minimal-API <see cref="IResult"/> against a fresh in-memory <see cref="HttpContext"/>
    /// and returns the status code and the exact bytes written to the response body — the same output a
    /// real client would observe.
    /// </summary>
    private static async Task<(int StatusCode, byte[] Body)> ExecuteAsync(IResult result)
    {
        await using var body = new MemoryStream();
        var context = new DefaultHttpContext
        {
            RequestServices = new ServiceCollection().AddLogging().BuildServiceProvider(),
        };
        context.Response.Body = body;

        await result.ExecuteAsync(context);

        return (context.Response.StatusCode, body.ToArray());
    }
}

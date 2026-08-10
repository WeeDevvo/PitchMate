using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.DependencyInjection;
using PitchMate.Api.LiveTracking.Endpoints;
using PitchMate.Domain.LiveTracking;

namespace PitchMate.Api.Tests.LiveTracking;

/// <summary>
/// Unit tests over <see cref="LiveTrackingErrorResults"/> — the single translation seam from an
/// Application/Domain <see cref="LiveTrackingError"/> to an HTTP result. These assert the authoritative
/// error table from the design's <c>Error Handling</c> section by <b>executing</b> each mapped
/// <see cref="IResult"/> against a real (in-memory) <see cref="HttpContext"/> and inspecting the status
/// code and the bytes actually written to the response body:
/// <list type="bullet">
/// <item><see cref="LiveTrackingErrorCode.Unauthorized"/> and <see cref="LiveTrackingErrorCode.NotFound"/>
/// produce a <b>byte-for-byte identical</b> <c>404</c> — same status <i>and</i> same serialized body —
/// so a non-member cannot distinguish "you are not permitted" from "no such match" and cannot probe for
/// another squad's match (Requirement 11.4).</item>
/// <item><see cref="LiveTrackingErrorCode.NotEnabled"/> (Requirement 9.1),
/// <see cref="LiveTrackingErrorCode.MatchNotStarted"/> (Requirement 7.2), and
/// <see cref="LiveTrackingErrorCode.LogSealed"/> (Requirement 7.3) are lifecycle/feature-state
/// conflicts and map to <c>409</c>.</item>
/// <item><see cref="LiveTrackingErrorCode.ValidationFailed"/> (an empty batch or a bad whole-request
/// input) and <see cref="LiveTrackingErrorCode.TargetNotFound"/> are input failures and map to
/// <c>400</c>.</item>
/// </list>
/// <para>Validates: Requirements 7.2, 7.3, 9.1, 11.4.</para>
/// </summary>
public sealed class LiveTrackingErrorResultsTests
{
    private const string DiagnosticMessage = "diagnostic detail only";

    // The authoritative LiveTrackingErrorCode -> HTTP status table for the non-concealed conflict and
    // input failures (design "Error Handling"). Unauthorized/NotFound are the concealed 404 pair and are
    // asserted separately for byte-identity.
    public static TheoryData<LiveTrackingErrorCode, int> DocumentedStatusMappings() => new()
    {
        { LiveTrackingErrorCode.NotEnabled, StatusCodes.Status409Conflict },
        { LiveTrackingErrorCode.MatchNotStarted, StatusCodes.Status409Conflict },
        { LiveTrackingErrorCode.LogSealed, StatusCodes.Status409Conflict },
        { LiveTrackingErrorCode.ValidationFailed, StatusCodes.Status400BadRequest },
        { LiveTrackingErrorCode.TargetNotFound, StatusCodes.Status400BadRequest },
    };

    [Theory]
    [MemberData(nameof(DocumentedStatusMappings))]
    public async Task ToHttpResult_MapsEachErrorCodeToItsDocumentedStatus(
        LiveTrackingErrorCode code, int expectedStatus)
    {
        (int status, _) = await ExecuteAsync(
            LiveTrackingErrorResults.ToHttpResult(new LiveTrackingError(code, DiagnosticMessage)));

        Assert.Equal(expectedStatus, status);
    }

    // Requirement 11.4 — Unauthorized and NotFound must be indistinguishable. Executing both results
    // against a fresh HttpContext and comparing the status code AND the exact response bytes proves
    // identity, not merely that both are 404 with a similar shape. Two differently-worded messages are
    // supplied on purpose: if the mapping ever leaked the error's Code or Message into the body, these
    // bodies would diverge and the assertion would fail.
    [Fact]
    public async Task ToHttpResult_MapsUnauthorizedAndNotFound_ToByteIdentical404()
    {
        (int unauthorizedStatus, byte[] unauthorizedBody) = await ExecuteAsync(
            LiveTrackingErrorResults.ToHttpResult(
                new LiveTrackingError(LiveTrackingErrorCode.Unauthorized, "requester is not a member of the match's squad")));

        (int notFoundStatus, byte[] notFoundBody) = await ExecuteAsync(
            LiveTrackingErrorResults.ToHttpResult(
                new LiveTrackingError(LiveTrackingErrorCode.NotFound, "no such match")));

        Assert.Equal(StatusCodes.Status404NotFound, unauthorizedStatus);
        Assert.Equal(StatusCodes.Status404NotFound, notFoundStatus);

        // Byte-for-byte identity of the written body is the crux of the existence-concealment guarantee.
        Assert.Equal(unauthorizedBody, notFoundBody);
    }

    // The concealed 404 body must not echo the differing Code or Message of either failure — otherwise
    // the two responses above could only be identical by coincidence of message length. Assert the body
    // contains neither the enum name nor the diagnostic text of either error.
    [Fact]
    public async Task ToHttpResult_ConcealedResponse_LeaksNeitherCodeNorMessage()
    {
        (_, byte[] bodyBytes) = await ExecuteAsync(
            LiveTrackingErrorResults.ToHttpResult(new LiveTrackingError(LiveTrackingErrorCode.Unauthorized, DiagnosticMessage)));

        string body = Encoding.UTF8.GetString(bodyBytes);

        Assert.DoesNotContain(DiagnosticMessage, body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(nameof(LiveTrackingErrorCode.Unauthorized), body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(nameof(LiveTrackingErrorCode.NotFound), body, StringComparison.OrdinalIgnoreCase);
    }

    // The dedicated Concealed() helper is the single source of the 404 both codes route through, so it
    // must itself produce that same 404 response — guaranteeing the two mapped codes can never drift.
    [Fact]
    public async Task Concealed_ProducesTheSame404_AsTheMappedCodes()
    {
        (int concealedStatus, byte[] concealedBody) = await ExecuteAsync(LiveTrackingErrorResults.Concealed());
        (int mappedStatus, byte[] mappedBody) = await ExecuteAsync(
            LiveTrackingErrorResults.ToHttpResult(new LiveTrackingError(LiveTrackingErrorCode.NotFound, DiagnosticMessage)));

        Assert.Equal(StatusCodes.Status404NotFound, concealedStatus);
        Assert.Equal(mappedStatus, concealedStatus);
        Assert.Equal(mappedBody, concealedBody);
    }

    // Requirement 9.1 — recording against a squad without the LiveMatchTracking feature is a state
    // conflict, mapped to 409.
    [Fact]
    public async Task ToHttpResult_MapsNotEnabled_To409()
    {
        (int status, _) = await ExecuteAsync(
            LiveTrackingErrorResults.ToHttpResult(new LiveTrackingError(LiveTrackingErrorCode.NotEnabled, DiagnosticMessage)));

        Assert.Equal(StatusCodes.Status409Conflict, status);
    }

    // Requirement 7.2 — recording before the match is InProgress is a lifecycle conflict, mapped to 409.
    [Fact]
    public async Task ToHttpResult_MapsMatchNotStarted_To409()
    {
        (int status, _) = await ExecuteAsync(
            LiveTrackingErrorResults.ToHttpResult(new LiveTrackingError(LiveTrackingErrorCode.MatchNotStarted, DiagnosticMessage)));

        Assert.Equal(StatusCodes.Status409Conflict, status);
    }

    // Requirement 7.3 — recording against a Completed/Cancelled match (a sealed log) is a lifecycle
    // conflict, mapped to 409.
    [Fact]
    public async Task ToHttpResult_MapsLogSealed_To409()
    {
        (int status, _) = await ExecuteAsync(
            LiveTrackingErrorResults.ToHttpResult(new LiveTrackingError(LiveTrackingErrorCode.LogSealed, DiagnosticMessage)));

        Assert.Equal(StatusCodes.Status409Conflict, status);
    }

    // An empty batch / bad whole-request input is a client input failure, mapped to 400.
    [Fact]
    public async Task ToHttpResult_MapsValidationFailed_To400()
    {
        (int status, _) = await ExecuteAsync(
            LiveTrackingErrorResults.ToHttpResult(new LiveTrackingError(LiveTrackingErrorCode.ValidationFailed, DiagnosticMessage)));

        Assert.Equal(StatusCodes.Status400BadRequest, status);
    }

    // A retraction naming a non-existent target is an input failure, mapped to 400.
    [Fact]
    public async Task ToHttpResult_MapsTargetNotFound_To400()
    {
        (int status, _) = await ExecuteAsync(
            LiveTrackingErrorResults.ToHttpResult(new LiveTrackingError(LiveTrackingErrorCode.TargetNotFound, DiagnosticMessage)));

        Assert.Equal(StatusCodes.Status400BadRequest, status);
    }

    // Every genuine (non-concealed) failure carries a ProblemDetails body whose stable code is echoed in
    // the title and the `code` extension, so clients branch on the code rather than parsing the human
    // message.
    [Fact]
    public void ToHttpResult_EchoesTheStableCode_InProblemTitleAndExtension()
    {
        IResult result = LiveTrackingErrorResults.ToHttpResult(
            new LiveTrackingError(LiveTrackingErrorCode.LogSealed, DiagnosticMessage));

        var problem = Assert.IsType<ProblemHttpResult>(result);
        Assert.Equal(LiveTrackingErrorCode.LogSealed.ToString(), problem.ProblemDetails.Title);
        Assert.Equal(DiagnosticMessage, problem.ProblemDetails.Detail);
        Assert.True(problem.ProblemDetails.Extensions.TryGetValue("code", out object? codeValue));
        Assert.Equal(LiveTrackingErrorCode.LogSealed.ToString(), codeValue);
    }

    // Completeness guard: every declared LiveTrackingErrorCode has an explicit mapping. A newly added
    // code with no case falls through to 500, which this asserts against — so the table cannot silently
    // drift.
    [Fact]
    public async Task ToHttpResult_MapsEveryDeclaredCode_WithNoServerErrorFallthrough()
    {
        foreach (LiveTrackingErrorCode code in Enum.GetValues<LiveTrackingErrorCode>())
        {
            (int status, _) = await ExecuteAsync(
                LiveTrackingErrorResults.ToHttpResult(new LiveTrackingError(code, DiagnosticMessage)));

            Assert.NotEqual(StatusCodes.Status500InternalServerError, status);
        }
    }

    // The uniform unauthenticated result is a 401 for a protected endpoint whose caller identity could
    // not be resolved from the access token.
    [Fact]
    public async Task Unauthenticated_ReturnsA401()
    {
        (int status, _) = await ExecuteAsync(LiveTrackingErrorResults.Unauthenticated());

        Assert.Equal(StatusCodes.Status401Unauthorized, status);
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

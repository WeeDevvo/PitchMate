using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using PitchMate.Api.Squads.Endpoints;
using PitchMate.Domain.Squads;

namespace PitchMate.Api.Tests.Squads;

/// <summary>
/// Unit tests over <see cref="SquadErrorResults"/> — the single translation seam from a domain
/// <see cref="SquadError"/> to an HTTP result. These assert the authoritative error table from the
/// design's <c>Error Handling</c> section: every <see cref="SquadErrorCode"/> maps to exactly one
/// documented HTTP status, an authorisation failure on an existence-sensitive read is masked as
/// <c>404</c> so a non-member cannot learn whether the squad exists (Requirement 16.2), and the
/// uniform unauthenticated result is a bodyless <c>401</c> (Requirement 16.3).
/// <para>Validates: Requirements 16.2, 16.3.</para>
/// </summary>
public sealed class SquadErrorResultsTests
{
    private const string DiagnosticMessage = "diagnostic detail only";

    // The authoritative SquadErrorCode -> HTTP status table (design "Error Handling"). Unauthorized is
    // its non-concealed value here (403); the concealed 404 variant is asserted separately.
    public static TheoryData<SquadErrorCode, int> DocumentedStatusMappings() => new()
    {
        { SquadErrorCode.ValidationFailed, StatusCodes.Status400BadRequest },
        { SquadErrorCode.ExpiryRequired, StatusCodes.Status400BadRequest },
        { SquadErrorCode.Unauthorized, StatusCodes.Status403Forbidden },
        { SquadErrorCode.NotAMember, StatusCodes.Status404NotFound },
        { SquadErrorCode.DisplayNameInUse, StatusCodes.Status409Conflict },
        { SquadErrorCode.OwnerConstraint, StatusCodes.Status409Conflict },
        { SquadErrorCode.InviteLimitReached, StatusCodes.Status409Conflict },
        { SquadErrorCode.ClaimNotEligible, StatusCodes.Status409Conflict },
        { SquadErrorCode.SquadPendingDeletion, StatusCodes.Status409Conflict },
        { SquadErrorCode.ConcurrencyConflict, StatusCodes.Status409Conflict },
        { SquadErrorCode.InviteUnusable, StatusCodes.Status410Gone },
        { SquadErrorCode.AlreadyMember, StatusCodes.Status200OK },
    };

    [Theory]
    [MemberData(nameof(DocumentedStatusMappings))]
    public void ToHttpResult_MapsEachErrorCodeToItsDocumentedStatus(SquadErrorCode code, int expectedStatus)
    {
        IResult result = SquadErrorResults.ToHttpResult(new SquadError(code, DiagnosticMessage));

        Assert.Equal(expectedStatus, StatusCodeOf(result));
    }

    // Requirement 16.2 — an authorisation failure on an existence-sensitive read is reported as 404,
    // not 403, so a non-member cannot distinguish "not allowed" from "does not exist".
    [Fact]
    public void ToHttpResult_MasksUnauthorizedAs404_WhenConcealingExistence()
    {
        IResult result = SquadErrorResults.ToHttpResult(
            new SquadError(SquadErrorCode.Unauthorized, DiagnosticMessage), concealExistence: true);

        Assert.Equal(StatusCodes.Status404NotFound, StatusCodeOf(result));
    }

    // The concealment flag is scoped to authorisation failures only: it must not rewrite any other
    // code's status. Every non-Unauthorized code keeps its documented status under concealment.
    [Theory]
    [MemberData(nameof(DocumentedStatusMappings))]
    public void ToHttpResult_LeavesNonAuthorizationCodesUnchanged_UnderConcealment(
        SquadErrorCode code, int expectedStatus)
    {
        if (code == SquadErrorCode.Unauthorized)
        {
            return; // Covered by the dedicated masking test above.
        }

        IResult result = SquadErrorResults.ToHttpResult(
            new SquadError(code, DiagnosticMessage), concealExistence: true);

        Assert.Equal(expectedStatus, StatusCodeOf(result));
    }

    // The already-member outcome is a success no-op (200) carrying no ProblemDetails body, so a client
    // redeeming an invite it has already used is not shown a spurious error.
    [Fact]
    public void ToHttpResult_ReturnsBodylessOk_ForAlreadyMember()
    {
        IResult result = SquadErrorResults.ToHttpResult(new SquadError(SquadErrorCode.AlreadyMember, DiagnosticMessage));

        Assert.Equal(StatusCodes.Status200OK, StatusCodeOf(result));
        Assert.IsNotType<ProblemHttpResult>(result);
    }

    // Every genuine failure carries a ProblemDetails body whose stable code is echoed in the title and
    // the `code` extension, so clients branch on the code rather than parsing the human message.
    [Fact]
    public void ToHttpResult_EchoesTheStableCode_InProblemTitleAndExtension()
    {
        IResult result = SquadErrorResults.ToHttpResult(new SquadError(SquadErrorCode.DisplayNameInUse, DiagnosticMessage));

        var problem = Assert.IsType<ProblemHttpResult>(result);
        Assert.Equal(SquadErrorCode.DisplayNameInUse.ToString(), problem.ProblemDetails.Title);
        Assert.Equal(DiagnosticMessage, problem.ProblemDetails.Detail);
        Assert.True(problem.ProblemDetails.Extensions.TryGetValue("code", out object? codeValue));
        Assert.Equal(SquadErrorCode.DisplayNameInUse.ToString(), codeValue);
    }

    // Completeness guard: every declared SquadErrorCode has an explicit mapping. A newly added code with
    // no case falls through to 500, which this asserts against — so the table cannot silently drift.
    [Fact]
    public void ToHttpResult_MapsEveryDeclaredCode_WithNoServerErrorFallthrough()
    {
        foreach (SquadErrorCode code in Enum.GetValues<SquadErrorCode>())
        {
            IResult result = SquadErrorResults.ToHttpResult(new SquadError(code, DiagnosticMessage));

            Assert.NotEqual(StatusCodes.Status500InternalServerError, StatusCodeOf(result));
        }
    }

    // Requirement 16.3 — the uniform unauthenticated result is a 401.
    [Fact]
    public void Unauthenticated_ReturnsA401()
    {
        IResult result = SquadErrorResults.Unauthenticated();

        Assert.Equal(StatusCodes.Status401Unauthorized, StatusCodeOf(result));
    }

    /// <summary>Reads the status code a minimal-API <see cref="IResult"/> will write to the response.</summary>
    private static int StatusCodeOf(IResult result)
    {
        var withStatus = Assert.IsAssignableFrom<IStatusCodeHttpResult>(result);
        Assert.NotNull(withStatus.StatusCode);
        return withStatus.StatusCode!.Value;
    }
}

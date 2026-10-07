using Microsoft.AspNetCore.Http;
using PitchMate.Api.Auth.Endpoints;
using PitchMate.Api.LiveTracking.Endpoints;
using PitchMate.Api.Matches.Endpoints;
using PitchMate.Api.Notifications.Endpoints;
using PitchMate.Api.Squads.Endpoints;
using PitchMate.Api.Stats.Endpoints;
using PitchMate.Application.Auth;
using PitchMate.Application.Stats;
using PitchMate.Domain.LiveTracking;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Notifications;
using PitchMate.Domain.Squads;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// The expected table Property 5 compares against: for every error code of every seam variant, the
/// status and <c>ProblemDetails</c> body that code produced <b>before</b> this chore edited the seams,
/// read off the six <c>*ErrorResults</c> files at their pre-change revision.
/// <para>
/// <b>Why a table and not a re-derivation.</b> A guard that recomputed the expectation from today's
/// seam would be a tautology — it would pass whatever the seam did. The point of Requirement 2.12 is
/// that 66 endpoints' failure behaviour survives a change whose subject is response <i>metadata</i>,
/// and the only way to say that is to write down, independently, what the behaviour was. So the table
/// is hand-written from the pre-change source, and a future drift surfaces as a failing comparison that
/// can only be resolved by editing a row — which is a decision, in a diff, with a reviewer.
/// </para>
/// <para>
/// <b>What a row is.</b> The four values the seam decides: the status, the <c>title</c>, the
/// <c>detail</c> (the error's own message unless the seam substitutes fixed text), and the branchable
/// <c>code</c> extension. The <c>type</c> member is not a seam decision — <c>ProblemDetails</c> derives
/// it from the status alone, before and after — so it is pinned once per status in
/// <see cref="ProblemTypeUris"/> rather than repeated on 75 rows.
/// </para>
/// <para>
/// <b>The two recorded deviations.</b> Requirement 2.12 preserves everything "except for the code named
/// in Requirement 6", but two departures are present and both are deliberate:
/// </para>
/// <list type="number">
/// <item>
/// <description>
/// <b><see cref="SquadErrorCode.AlreadyMember"/> is now <c>409 Conflict</c>, and was a bodiless
/// <c>200 OK</c></b> (design D5, Requirements 6.1, 6.2). This is the one code Property 5 explicitly
/// excludes from the preservation rule, so its rows sit in the table for completeness and are carved
/// out of the quantification by <see cref="CorrectedCodeName"/>. It appears twice, once per squad
/// variant, because the pre-change bodiless <c>200</c> was reached under both.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Three concealing arms now emit the fixed, code-agnostic concealed <c>404</c>.</b> Before this
/// chore, <see cref="SquadErrorResults"/> and <see cref="MatchErrorResults"/> answered a concealed
/// authorisation failure with a <c>404</c> that still echoed <c>title</c> and <c>code</c> as
/// <c>"Unauthorized"</c>, and <see cref="NotificationErrorResults"/> did the same with
/// <c>"NotFound"</c> — a <c>404</c> naming the cause it exists to hide. Task 11.1 found that and routed
/// all three through each seam's fixed <c>Concealed()</c> result. The table therefore records the
/// <i>concealed</i> body for those three rows, not the pre-fix code-carrying one, because the specific
/// rule beats the general one: Requirement 2.11 carves concealed not-founds out of the code-extension
/// rule in the first place, and Requirements 5.2 and 5.6 forbid the <c>code</c> there outright. A table
/// that preserved the pre-fix body would require the guard to assert a disclosure.
/// <see cref="SeamBehaviourPreservationProperties.TheConcealedDeviationsEmitTheirSeamsFixedConcealedBody"/>
/// pins that each of the three is byte-for-byte that seam's real <c>Concealed()</c> result, so the
/// deviation is held to the reason it was made.
/// </description>
/// </item>
/// </list>
/// <para>
/// Everything else — all 70 remaining rows across the six seams — is the pre-change behaviour verbatim,
/// including the <c>Results.Problem</c> to <c>TypedResults.Problem</c> switch of task 10.2, which is a
/// compile-time change only: both write the same <c>ProblemHttpResult</c>, and the table asserts the
/// bytes did not move.
/// </para>
/// </summary>
public static class SeamBehaviourBaseline
{
    /// <summary>
    /// The one error code Property 5 excludes, being the status correction of Requirement 6 and the
    /// only behaviour change this chore makes to a seam's decision.
    /// </summary>
    public const string CorrectedCodeName = nameof(SquadErrorCode.AlreadyMember);

    /// <summary>The fixed title every seam's concealed not-found writes.</summary>
    public const string ConcealedTitle = "Not Found";

    /// <summary>The fixed detail every seam's concealed not-found writes.</summary>
    public const string ConcealedDetail = "The requested resource was not found.";

    /// <summary>The fixed detail the stats seam substitutes for a computation failure.</summary>
    public const string ComputationFailedDetail =
        "The statistics could not be computed. Please try again later.";

    private const string AlreadyMemberPreChange =
        "a bodiless 200 OK (Results.Ok()), on the since-invalidated reading that 'already a member' is "
            + "a redemption no-op; corrected to 409 Conflict by design D5 and Requirements 6.1, 6.2";

    private static readonly string AuthStandard = Variant(nameof(AuthErrorResults), ProblemSeams.Standard);
    private static readonly string SquadStandard = Variant(nameof(SquadErrorResults), ProblemSeams.Standard);
    private static readonly string SquadConcealed = Variant(nameof(SquadErrorResults), ProblemSeams.Concealed);
    private static readonly string MatchStandard = Variant(nameof(MatchErrorResults), ProblemSeams.Standard);
    private static readonly string MatchConcealed = Variant(nameof(MatchErrorResults), ProblemSeams.Concealed);
    private static readonly string StatsStandard = Variant(nameof(StatsErrorResults), ProblemSeams.Standard);
    private static readonly string NotificationStandard =
        Variant(nameof(NotificationErrorResults), ProblemSeams.Standard);
    private static readonly string LiveTrackingStandard =
        Variant(nameof(LiveTrackingErrorResults), ProblemSeams.Standard);

    /// <summary>
    /// The <c>type</c> member <c>ProblemDetails</c> writes for each status this surface emits. Pinned
    /// rather than recomputed so a framework change to the defaults shows up as a failure here, where it
    /// can be read as "the wire moved for a reason that is not ours" instead of silently altering every
    /// problem body on the surface.
    /// </summary>
    public static IReadOnlyDictionary<int, string> ProblemTypeUris { get; } =
        new Dictionary<int, string>
        {
            [StatusCodes.Status400BadRequest] = "https://tools.ietf.org/html/rfc9110#section-15.5.1",
            [StatusCodes.Status401Unauthorized] = "https://tools.ietf.org/html/rfc9110#section-15.5.2",
            [StatusCodes.Status403Forbidden] = "https://tools.ietf.org/html/rfc9110#section-15.5.4",
            [StatusCodes.Status404NotFound] = "https://tools.ietf.org/html/rfc9110#section-15.5.5",
            [StatusCodes.Status409Conflict] = "https://tools.ietf.org/html/rfc9110#section-15.5.10",
            [StatusCodes.Status410Gone] = "https://tools.ietf.org/html/rfc9110#section-15.5.11",
            [StatusCodes.Status500InternalServerError] =
                "https://tools.ietf.org/html/rfc9110#section-15.6.1",
            [StatusCodes.Status502BadGateway] = "https://tools.ietf.org/html/rfc9110#section-15.6.3",
            [StatusCodes.Status503ServiceUnavailable] =
                "https://tools.ietf.org/html/rfc9110#section-15.6.4",
        };

    /// <summary>
    /// Every row of the table: one per error code of each of the eight (seam, variant) pairings
    /// <see cref="ProblemSeams"/> drives.
    /// </summary>
    public static IReadOnlyList<SeamBehaviourExpectation> Rows { get; } = Build();

    /// <summary>The rows indexed by <see cref="SeamBehaviourExpectation.Key"/>.</summary>
    public static IReadOnlyDictionary<string, SeamBehaviourExpectation> ByKey { get; } =
        Rows.ToDictionary(static row => row.Key, StringComparer.Ordinal);

    /// <summary>
    /// Every row that departs from the pre-change behaviour, named explicitly. The guard derives the
    /// departing set from <see cref="Rows"/> and compares it with this list, so a row that quietly
    /// acquired a <c>PreChange</c> note — the easy way to make a regression look sanctioned — fails
    /// rather than passes.
    /// </summary>
    public static IReadOnlyList<string> DeclaredDeviations { get; } =
    [
        "MatchErrorResults (concealed)|Unauthorized",
        "NotificationErrorResults (standard)|NotFound",
        "SquadErrorResults (concealed)|AlreadyMember",
        "SquadErrorResults (concealed)|Unauthorized",
        "SquadErrorResults (standard)|AlreadyMember",
    ];

    /// <summary>
    /// The three rows whose deviation is the concealment correction of task 11.1, as distinct from the
    /// two <see cref="CorrectedCodeName"/> rows of Requirement 6.
    /// </summary>
    public static IReadOnlyList<string> ConcealmentCorrections { get; } =
    [
        "MatchErrorResults (concealed)|Unauthorized",
        "NotificationErrorResults (standard)|NotFound",
        "SquadErrorResults (concealed)|Unauthorized",
    ];

    /// <summary>The baseline row for a driven seam call, or <see langword="null"/> where none exists.</summary>
    /// <param name="problem">The driven code.</param>
    /// <returns>That code's expected status and body.</returns>
    public static SeamBehaviourExpectation? For(SeamProblem problem)
    {
        ArgumentNullException.ThrowIfNull(problem);

        return ByKey.TryGetValue($"{problem.SeamVariant}|{problem.CodeName}", out SeamBehaviourExpectation? row)
            ? row
            : null;
    }

    /// <summary>Whether a driven code is inside Property 5's quantification.</summary>
    /// <param name="problem">The driven code.</param>
    /// <returns><see langword="false"/> for the one corrected code, otherwise <see langword="true"/>.</returns>
    public static bool IsInScope(SeamProblem problem)
    {
        ArgumentNullException.ThrowIfNull(problem);

        return !string.Equals(problem.CodeName, CorrectedCodeName, StringComparison.Ordinal);
    }

    private static string Variant(string seamName, string variantName) => $"{seamName} ({variantName})";

    private static IReadOnlyList<SeamBehaviourExpectation> Build() =>
    [
        // ── AuthErrorResults (standard) ─────────────────────────────────────────────────────────────
        // Untouched by this chore: the seam already used TypedResults and has no concealing path, so
        // every row is the pre-change mapping verbatim.
        Problem(AuthStandard, nameof(AuthErrorCode.DuplicateIdentity), StatusCodes.Status409Conflict),
        Problem(AuthStandard, nameof(AuthErrorCode.EmailAlreadyRegistered), StatusCodes.Status409Conflict),
        Problem(AuthStandard, nameof(AuthErrorCode.PasswordPolicy), StatusCodes.Status400BadRequest),
        Problem(AuthStandard, nameof(AuthErrorCode.InvalidEmail), StatusCodes.Status400BadRequest),
        Problem(AuthStandard, nameof(AuthErrorCode.TokenExpired), StatusCodes.Status400BadRequest),
        Problem(AuthStandard, nameof(AuthErrorCode.TokenInvalid), StatusCodes.Status400BadRequest),
        Problem(AuthStandard, nameof(AuthErrorCode.AuthenticationFailed), StatusCodes.Status401Unauthorized),
        Problem(AuthStandard, nameof(AuthErrorCode.EmailNotVerified), StatusCodes.Status403Forbidden),
        Problem(AuthStandard, nameof(AuthErrorCode.ValidationFailed), StatusCodes.Status400BadRequest),
        Problem(AuthStandard, nameof(AuthErrorCode.DeliveryFailed), StatusCodes.Status502BadGateway),
        Problem(AuthStandard, nameof(AuthErrorCode.LastIdentity), StatusCodes.Status409Conflict),
        Problem(AuthStandard, nameof(AuthErrorCode.PasswordMethodExists), StatusCodes.Status409Conflict),
        Problem(AuthStandard, nameof(AuthErrorCode.IdentityAlreadyLinked), StatusCodes.Status409Conflict),
        Problem(AuthStandard, nameof(AuthErrorCode.Unauthenticated), StatusCodes.Status401Unauthorized),
        Problem(AuthStandard, nameof(AuthErrorCode.UserNotFound), StatusCodes.Status404NotFound),

        // ── SquadErrorResults (standard) ────────────────────────────────────────────────────────────
        // The ordinary mapping, where an authorisation failure is a code-echoing 403 and nothing is
        // concealed. AlreadyMember is the one corrected code (deviation 1).
        Problem(SquadStandard, nameof(SquadErrorCode.ValidationFailed), StatusCodes.Status400BadRequest),
        Problem(SquadStandard, nameof(SquadErrorCode.DisplayNameInUse), StatusCodes.Status409Conflict),
        Problem(SquadStandard, nameof(SquadErrorCode.Unauthorized), StatusCodes.Status403Forbidden),
        Problem(SquadStandard, nameof(SquadErrorCode.NotAMember), StatusCodes.Status404NotFound),
        Problem(SquadStandard, nameof(SquadErrorCode.OwnerConstraint), StatusCodes.Status409Conflict),
        Problem(
            SquadStandard,
            nameof(SquadErrorCode.AlreadyMember),
            StatusCodes.Status409Conflict,
            preChange: AlreadyMemberPreChange),
        Problem(SquadStandard, nameof(SquadErrorCode.InviteUnusable), StatusCodes.Status410Gone),
        Problem(SquadStandard, nameof(SquadErrorCode.InviteLimitReached), StatusCodes.Status409Conflict),
        Problem(SquadStandard, nameof(SquadErrorCode.ExpiryRequired), StatusCodes.Status400BadRequest),
        Problem(SquadStandard, nameof(SquadErrorCode.ClaimNotEligible), StatusCodes.Status409Conflict),
        Problem(SquadStandard, nameof(SquadErrorCode.SquadPendingDeletion), StatusCodes.Status409Conflict),
        Problem(SquadStandard, nameof(SquadErrorCode.ConcurrencyConflict), StatusCodes.Status409Conflict),

        // ── SquadErrorResults (concealed) ───────────────────────────────────────────────────────────
        // Identical to the standard variant but for Unauthorized, which the existence-sensitive reads
        // answer with the fixed concealed 404 (deviation 2).
        Problem(SquadConcealed, nameof(SquadErrorCode.ValidationFailed), StatusCodes.Status400BadRequest),
        Problem(SquadConcealed, nameof(SquadErrorCode.DisplayNameInUse), StatusCodes.Status409Conflict),
        Concealed(
            SquadConcealed,
            nameof(SquadErrorCode.Unauthorized),
            preChange: "404 Not Found echoing title 'Unauthorized', the error's own message as detail, "
                + "and code 'Unauthorized' — a concealing response naming the cause it conceals; routed "
                + "through SquadErrorResults.Concealed() by task 11.1 (Requirements 2.11, 5.2, 5.6)"),
        Problem(SquadConcealed, nameof(SquadErrorCode.NotAMember), StatusCodes.Status404NotFound),
        Problem(SquadConcealed, nameof(SquadErrorCode.OwnerConstraint), StatusCodes.Status409Conflict),
        Problem(
            SquadConcealed,
            nameof(SquadErrorCode.AlreadyMember),
            StatusCodes.Status409Conflict,
            preChange: AlreadyMemberPreChange),
        Problem(SquadConcealed, nameof(SquadErrorCode.InviteUnusable), StatusCodes.Status410Gone),
        Problem(SquadConcealed, nameof(SquadErrorCode.InviteLimitReached), StatusCodes.Status409Conflict),
        Problem(SquadConcealed, nameof(SquadErrorCode.ExpiryRequired), StatusCodes.Status400BadRequest),
        Problem(SquadConcealed, nameof(SquadErrorCode.ClaimNotEligible), StatusCodes.Status409Conflict),
        Problem(SquadConcealed, nameof(SquadErrorCode.SquadPendingDeletion), StatusCodes.Status409Conflict),
        Problem(SquadConcealed, nameof(SquadErrorCode.ConcurrencyConflict), StatusCodes.Status409Conflict),

        // ── MatchErrorResults (standard) ────────────────────────────────────────────────────────────
        Problem(MatchStandard, nameof(MatchErrorCode.ValidationFailed), StatusCodes.Status400BadRequest),
        Problem(MatchStandard, nameof(MatchErrorCode.Unauthorized), StatusCodes.Status403Forbidden),
        Problem(MatchStandard, nameof(MatchErrorCode.InvalidState), StatusCodes.Status409Conflict),
        Problem(MatchStandard, nameof(MatchErrorCode.ThresholdNotMet), StatusCodes.Status409Conflict),
        Problem(MatchStandard, nameof(MatchErrorCode.NotAParticipant), StatusCodes.Status404NotFound),
        Problem(MatchStandard, nameof(MatchErrorCode.AlreadyParticipant), StatusCodes.Status409Conflict),
        Problem(MatchStandard, nameof(MatchErrorCode.LiveTrackingDisabled), StatusCodes.Status409Conflict),
        Problem(MatchStandard, nameof(MatchErrorCode.ResultRequired), StatusCodes.Status409Conflict),
        Problem(MatchStandard, nameof(MatchErrorCode.ConcurrencyConflict), StatusCodes.Status409Conflict),

        // ── MatchErrorResults (concealed) ───────────────────────────────────────────────────────────
        Problem(MatchConcealed, nameof(MatchErrorCode.ValidationFailed), StatusCodes.Status400BadRequest),
        Concealed(
            MatchConcealed,
            nameof(MatchErrorCode.Unauthorized),
            preChange: "404 Not Found echoing title 'Unauthorized', the error's own message as detail, "
                + "and code 'Unauthorized'; routed through MatchErrorResults.Concealed() by task 11.1 "
                + "(Requirements 2.11, 5.2, 5.6)"),
        Problem(MatchConcealed, nameof(MatchErrorCode.InvalidState), StatusCodes.Status409Conflict),
        Problem(MatchConcealed, nameof(MatchErrorCode.ThresholdNotMet), StatusCodes.Status409Conflict),
        Problem(MatchConcealed, nameof(MatchErrorCode.NotAParticipant), StatusCodes.Status404NotFound),
        Problem(MatchConcealed, nameof(MatchErrorCode.AlreadyParticipant), StatusCodes.Status409Conflict),
        Problem(MatchConcealed, nameof(MatchErrorCode.LiveTrackingDisabled), StatusCodes.Status409Conflict),
        Problem(MatchConcealed, nameof(MatchErrorCode.ResultRequired), StatusCodes.Status409Conflict),
        Problem(MatchConcealed, nameof(MatchErrorCode.ConcurrencyConflict), StatusCodes.Status409Conflict),

        // ── StatsErrorResults (standard) ────────────────────────────────────────────────────────────
        // Wholly concealing before this chore and after it: both Unauthorized and NotFound already
        // routed through the one fixed Concealed() result, so neither is a deviation.
        Concealed(StatsStandard, nameof(StatsErrorCode.Unauthorized)),
        Concealed(StatsStandard, nameof(StatsErrorCode.NotFound)),
        Problem(StatsStandard, nameof(StatsErrorCode.UnsupportedStatistic), StatusCodes.Status400BadRequest),
        Problem(
            StatsStandard,
            nameof(StatsErrorCode.ComputationFailed),
            StatusCodes.Status503ServiceUnavailable,
            fixedDetail: ComputationFailedDetail),

        // ── NotificationErrorResults (standard) ─────────────────────────────────────────────────────
        Problem(
            NotificationStandard,
            nameof(NotificationErrorCode.UnknownNotificationType),
            StatusCodes.Status400BadRequest),
        Problem(
            NotificationStandard,
            nameof(NotificationErrorCode.ValidationFailed),
            StatusCodes.Status400BadRequest),
        Problem(
            NotificationStandard,
            nameof(NotificationErrorCode.InvalidReadStateTransition),
            StatusCodes.Status400BadRequest),
        Concealed(
            NotificationStandard,
            nameof(NotificationErrorCode.NotFound),
            preChange: "404 Not Found echoing title 'NotFound', the error's own message as detail, and "
                + "code 'NotFound' — although this code is precisely the collapse of 'does not exist', "
                + "'not the caller's record' and 'squad you cannot see'; routed through "
                + "NotificationErrorResults.Concealed() by task 11.1 (Requirements 2.11, 5.2, 5.6)"),
        Problem(
            NotificationStandard,
            nameof(NotificationErrorCode.Unauthenticated),
            StatusCodes.Status401Unauthorized),
        Problem(
            NotificationStandard,
            nameof(NotificationErrorCode.PublishFailed),
            StatusCodes.Status500InternalServerError),
        Problem(
            NotificationStandard,
            nameof(NotificationErrorCode.RemovalFailed),
            StatusCodes.Status500InternalServerError),

        // ── LiveTrackingErrorResults (standard) ─────────────────────────────────────────────────────
        // Also wholly concealing before this chore: Unauthorized and NotFound shared the fixed
        // Concealed() result already, so neither is a deviation.
        Problem(
            LiveTrackingStandard,
            nameof(LiveTrackingErrorCode.ValidationFailed),
            StatusCodes.Status400BadRequest),
        Concealed(LiveTrackingStandard, nameof(LiveTrackingErrorCode.Unauthorized)),
        Problem(
            LiveTrackingStandard,
            nameof(LiveTrackingErrorCode.NotEnabled),
            StatusCodes.Status409Conflict),
        Problem(
            LiveTrackingStandard,
            nameof(LiveTrackingErrorCode.MatchNotStarted),
            StatusCodes.Status409Conflict),
        Problem(
            LiveTrackingStandard,
            nameof(LiveTrackingErrorCode.LogSealed),
            StatusCodes.Status409Conflict),
        Problem(
            LiveTrackingStandard,
            nameof(LiveTrackingErrorCode.TargetNotFound),
            StatusCodes.Status400BadRequest),
        Concealed(LiveTrackingStandard, nameof(LiveTrackingErrorCode.NotFound)),
    ];

    /// <summary>
    /// A code-echoing problem body: the status, with the code's own name as both <c>title</c> and the
    /// branchable <c>code</c> extension, and the error's message as <c>detail</c> unless the seam
    /// substitutes its own.
    /// </summary>
    private static SeamBehaviourExpectation Problem(
        string seamVariant,
        string codeName,
        int status,
        string? fixedDetail = null,
        string? preChange = null) =>
        new(seamVariant, codeName, status, codeName, codeName, fixedDetail, preChange);

    /// <summary>
    /// The fixed, code-agnostic concealed not-found: <c>404</c>, a constant title and detail, and no
    /// <c>code</c> extension at all.
    /// </summary>
    private static SeamBehaviourExpectation Concealed(
        string seamVariant,
        string codeName,
        string? preChange = null) =>
        new(
            seamVariant,
            codeName,
            StatusCodes.Status404NotFound,
            ConcealedTitle,
            Code: null,
            FixedDetail: ConcealedDetail,
            PreChange: preChange);
}

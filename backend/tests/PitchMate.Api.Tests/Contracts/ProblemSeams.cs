using Microsoft.AspNetCore.Http;
using PitchMate.Api.Auth.Endpoints;
using PitchMate.Api.LiveTracking.Endpoints;
using PitchMate.Api.Matches.Endpoints;
using PitchMate.Api.Notifications.Endpoints;
using PitchMate.Api.Squads.Endpoints;
using PitchMate.Api.Stats.Endpoints;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// Every error code of every subsystem, as a call to the real seam that translates it — the input
/// space Property 11 quantifies over.
/// <para>
/// Nothing here hard-codes an error code. Each seam's codes come from <see cref="Enum.GetValues{T}()"/>
/// over its error-code enum, so a code added next year is driven through its seam and lands under the
/// branchable-code rule with this file unedited. That is the whole point: the failure this guard exists
/// to catch is a <i>new</i> code reaching the wire without the stable <c>code</c> extension a client
/// branches on, and a guard built over a hand-maintained list of codes would pass for exactly as long
/// as someone remembered to extend the list.
/// </para>
/// <para>
/// <b>Why eight variants and not eleven.</b> The seam-coverage guard drives a <c>standard</c> and a
/// <c>concealed</c> variant for notifications and live tracking as well, because its subject is the
/// relationship between a seam and the declared status set of each convention composed onto it, and
/// those subsystems have a concealing convention whose declared set has to be measured. Here the
/// subject is the <i>body</i> a code produces, and those two seams take no concealment flag — calling
/// them a second time would re-drive identical inputs and add duplicate assertions rather than
/// coverage. Squads and matches genuinely branch on the flag, so both of their variants are driven.
/// </para>
/// <para>
/// <see cref="ConcealedControls"/> holds each seam's fixed, code-agnostic concealed not-found. It is
/// the yardstick by which a code is classified as concealed (see <see cref="SeamProblem"/>): the
/// classification compares bytes against the real <c>Concealed()</c> result rather than consulting a
/// list of code names. The auth seam has no concealing path and therefore no entry.
/// </para>
/// </summary>
public static class ProblemSeams
{
    /// <summary>The number of error seams the design declares, used as the non-vacuity floor.</summary>
    public const int DeclaredSeamCount = 6;

    /// <summary>
    /// The number of (seam, variant) pairings driven here: one for each of the six seams, plus the
    /// existence-concealing variants of the two seams that take a concealment flag.
    /// </summary>
    public const int DeclaredVariantCount = 8;

    /// <summary>The variant name for a seam called in its ordinary, code-echoing manner.</summary>
    public const string Standard = "standard";

    /// <summary>The variant name for a seam called with its existence-concealment flag set.</summary>
    public const string Concealed = "concealed";

    // Deliberately unlike the concealed body's fixed detail, so a code can only be classified as
    // concealed because it was genuinely routed through Concealed() — never because the diagnostic
    // text happened to match.
    private const string DiagnosticMessage = "diagnostic detail only";

    private const string ResidualTokenCause = "the access token was missing, malformed or expired";

    /// <summary>Every error code of every seam variant, as a call to the real seam.</summary>
    public static IReadOnlyList<ProblemSeamCall> All { get; } = Discover();

    /// <summary>
    /// Each seam's fixed, code-agnostic concealed not-found, keyed by seam name. Seams with no
    /// concealing path are absent.
    /// </summary>
    public static IReadOnlyDictionary<string, ConcealedFailure> ConcealedControls { get; } =
        new Dictionary<string, ConcealedFailure>(StringComparer.Ordinal)
        {
            [nameof(SquadErrorResults)] = Control(nameof(SquadErrorResults), SquadErrorResults.Concealed),
            [nameof(MatchErrorResults)] = Control(nameof(MatchErrorResults), MatchErrorResults.Concealed),
            [nameof(NotificationErrorResults)] =
                Control(nameof(NotificationErrorResults), NotificationErrorResults.Concealed),
            [nameof(StatsErrorResults)] = Control(nameof(StatsErrorResults), StatsErrorResults.Concealed),
            [nameof(LiveTrackingErrorResults)] =
                Control(nameof(LiveTrackingErrorResults), LiveTrackingErrorResults.Concealed),
        };

    /// <summary>The distinct seam names discovered, for the non-vacuity floor.</summary>
    public static IReadOnlyList<string> SeamNames { get; } =
        [.. All.Select(static call => call.SeamName).Distinct(StringComparer.Ordinal)];

    /// <summary>The distinct (seam, variant) pairings discovered, for the non-vacuity floor.</summary>
    public static IReadOnlyList<string> SeamVariants { get; } =
        [.. All.Select(static call => call.SeamVariant).Distinct(StringComparer.Ordinal)];

    /// <summary>The error-code enum driven under one (seam, variant) pairing.</summary>
    /// <param name="seamVariant">The pairing, as <see cref="ProblemSeamCall.SeamVariant"/> renders it.</param>
    /// <returns>That pairing's error-code enum.</returns>
    public static Type ErrorCodeTypeOf(string seamVariant) =>
        All.First(call => string.Equals(call.SeamVariant, seamVariant, StringComparison.Ordinal))
            .ErrorCodeType;

    private static IReadOnlyList<ProblemSeamCall> Discover() =>
    [
        // Auth — no concealment flag and no concealing path at all, so every one of its codes is
        // branchable and every one of its bodies must carry the code.
        .. Variant<PitchMate.Application.Auth.AuthErrorCode>(
            nameof(AuthErrorResults),
            Standard,
            static code => AuthErrorResults.ToHttpResult(
                new PitchMate.Application.Auth.AuthError(code, DiagnosticMessage))),

        // Squads — the ordinary mapping, where an authorisation failure is a code-echoing 403.
        .. Variant<PitchMate.Domain.Squads.SquadErrorCode>(
            nameof(SquadErrorResults),
            Standard,
            static code => SquadErrorResults.ToHttpResult(
                new PitchMate.Domain.Squads.SquadError(code, DiagnosticMessage))),

        // Squads — the existence-sensitive reads, where Unauthorized alone is swallowed by the
        // concealed 404 and every other code still carries its own.
        .. Variant<PitchMate.Domain.Squads.SquadErrorCode>(
            nameof(SquadErrorResults),
            Concealed,
            static code => SquadErrorResults.ToHttpResult(
                new PitchMate.Domain.Squads.SquadError(code, DiagnosticMessage), concealExistence: true)),

        // Matches — the ordinary mapping.
        .. Variant<PitchMate.Domain.Matches.MatchErrorCode>(
            nameof(MatchErrorResults),
            Standard,
            static code => MatchErrorResults.ToHttpResult(
                new PitchMate.Domain.Matches.MatchError(code, DiagnosticMessage))),

        // Matches — the existence-sensitive reads.
        .. Variant<PitchMate.Domain.Matches.MatchErrorCode>(
            nameof(MatchErrorResults),
            Concealed,
            static code => MatchErrorResults.ToHttpResult(
                new PitchMate.Domain.Matches.MatchError(code, DiagnosticMessage), concealExistence: true)),

        // Stats — wholly concealing: Unauthorized and NotFound both route through the one fixed
        // result, and the remaining codes are branchable.
        .. Variant<PitchMate.Application.Stats.StatsErrorCode>(
            nameof(StatsErrorResults),
            Standard,
            static code => StatsErrorResults.ToHttpResult(
                new PitchMate.Application.Stats.StatsError(code, DiagnosticMessage))),

        // Notifications — the seam takes no flag because the handlers conceal one layer in, collapsing
        // several causes onto NotFound before the seam sees them; NotFound therefore always conceals.
        .. Variant<PitchMate.Domain.Notifications.NotificationErrorCode>(
            nameof(NotificationErrorResults),
            Standard,
            static code => NotificationErrorResults.ToHttpResult(
                new PitchMate.Domain.Notifications.NotificationError(code, DiagnosticMessage))),

        // Live tracking — wholly concealing in the same way as stats: two codes, one fixed result.
        .. Variant<PitchMate.Domain.LiveTracking.LiveTrackingErrorCode>(
            nameof(LiveTrackingErrorResults),
            Standard,
            static code => LiveTrackingErrorResults.ToHttpResult(
                new PitchMate.Domain.LiveTracking.LiveTrackingError(code, DiagnosticMessage))),
    ];

    /// <summary>
    /// Builds one call per member of <typeparamref name="TCode"/>, as reflection reports them.
    /// </summary>
    /// <typeparam name="TCode">The seam's error-code enum.</typeparam>
    /// <param name="seamName">The seam class name.</param>
    /// <param name="variantName">The variant name.</param>
    /// <param name="produce">Calls the seam for one error code, in this variant's manner.</param>
    /// <returns>One call per error code.</returns>
    private static IReadOnlyList<ProblemSeamCall> Variant<TCode>(
        string seamName,
        string variantName,
        Func<TCode, IResult> produce)
        where TCode : struct, Enum =>
    [
        .. Enum.GetValues<TCode>()
            .Select(code => new ProblemSeamCall(
                seamName,
                variantName,
                typeof(TCode),
                code.ToString(),
                new ConcealedFailure(
                    seamName,
                    $"{typeof(TCode).Name}.{code}",
                    DiagnosticMessage,
                    () => produce(code)))),
    ];

    private static ConcealedFailure Control(string seamName, Func<IResult> concealed) =>
        new(seamName, $"{seamName}.Concealed()", ResidualTokenCause, concealed);
}

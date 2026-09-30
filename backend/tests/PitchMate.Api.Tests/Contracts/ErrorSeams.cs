using Microsoft.AspNetCore.Http;
using PitchMate.Api.Auth.Endpoints;
using PitchMate.Api.LiveTracking.Endpoints;
using PitchMate.Api.Matches.Endpoints;
using PitchMate.Api.Notifications.Endpoints;
using PitchMate.Api.Squads.Endpoints;
using PitchMate.Api.Stats.Endpoints;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// Drives every error code of every subsystem through its real error seam and pairs the statuses that
/// come back with the declared problem set of the response convention sitting beside that seam.
/// <para>
/// Nothing here hard-codes an error code. Each seam's codes come from
/// <see cref="Enum.GetValues(Type)"/> over its error-code enum, so a code added later is driven through
/// the seam — and therefore covered by the seam-coverage guard — without this file being edited. The
/// statuses are not hard-coded either: they are read off the <see cref="IResult"/> the seam returns, so
/// the guard compares what the mapping table <i>does</i> against what the convention <i>says</i>, which
/// is the only comparison that can catch the two drifting apart (Requirement 3.5).
/// </para>
/// <para>
/// Each seam contributes one variant per way it can be called. The two seams that take a concealment
/// flag (squads, matches) contribute a <c>standard</c> variant checked against
/// <c>DeclaredProblemStatuses</c> and a <c>concealed</c> variant checked against
/// <c>DeclaredConcealedProblemStatuses</c>, so the substitution of <c>404</c> for <c>403</c> is measured
/// rather than assumed. The notification and live-tracking seams conceal one layer in — the handlers
/// and the seam itself already collapse an authorisation failure into a not-found — so their concealing
/// convention declares the same set, and both variants are still driven so that remains true by
/// measurement.
/// </para>
/// <para>
/// Alongside the codes, each seam's fixed results are driven too: the uniform <c>401</c>
/// <c>Unauthenticated()</c> result where the seam exposes one, and the code-agnostic concealed
/// <c>404</c> where it has one. Those are statuses the seam can emit without any error code being
/// involved, and Requirement 2.8's residual unresolvable-subject case is exactly what they answer.
/// </para>
/// </summary>
public static class ErrorSeams
{
    /// <summary>The number of error seams the design declares, used as the non-vacuity floor.</summary>
    public const int DeclaredSeamCount = 6;

    private const string DiagnosticMessage = "diagnostic detail only";
    private const string Standard = "standard";
    private const string Concealed = "concealed";

    /// <summary>
    /// Every (seam, variant) pairing, each carrying its measured emissions and the declared problem set
    /// it is to be covered by.
    /// </summary>
    public static IReadOnlyList<ErrorSeamVariant> All { get; } = Discover();

    /// <summary>Every measured emission across every seam and variant.</summary>
    public static IReadOnlyList<SeamEmission> AllEmissions { get; } =
        [.. All.SelectMany(variant => variant.Emissions)];

    /// <summary>The distinct seam names discovered, for the non-vacuity floor.</summary>
    public static IReadOnlyList<string> SeamNames { get; } =
        [.. All.Select(variant => variant.SeamName).Distinct(StringComparer.Ordinal)];

    private static IReadOnlyList<ErrorSeamVariant> Discover() =>
    [
        // Auth — one variant: this seam has no concealment flag, and no fixed result of its own
        // (the residual unresolvable-subject case is answered by its Unauthenticated error code).
        Variant<PitchMate.Application.Auth.AuthErrorCode>(
            nameof(AuthErrorResults),
            Standard,
            $"{nameof(AuthResponseConventions)}.{nameof(AuthResponseConventions.DeclaredProblemStatuses)}",
            AuthResponseConventions.DeclaredProblemStatuses,
            code => AuthErrorResults.ToHttpResult(
                new PitchMate.Application.Auth.AuthError(code, DiagnosticMessage))),

        // Squads — the ordinary mapping, where an authorisation failure is a 403.
        Variant<PitchMate.Domain.Squads.SquadErrorCode>(
            nameof(SquadErrorResults),
            Standard,
            $"{nameof(SquadResponseConventions)}.{nameof(SquadResponseConventions.DeclaredProblemStatuses)}",
            SquadResponseConventions.DeclaredProblemStatuses,
            code => SquadErrorResults.ToHttpResult(
                new PitchMate.Domain.Squads.SquadError(code, DiagnosticMessage)),
            ($"{nameof(SquadErrorResults)}.{nameof(SquadErrorResults.Unauthenticated)}()",
                SquadErrorResults.Unauthenticated())),

        // Squads — the existence-sensitive reads, where that authorisation failure becomes a 404.
        Variant<PitchMate.Domain.Squads.SquadErrorCode>(
            nameof(SquadErrorResults),
            Concealed,
            $"{nameof(SquadResponseConventions)}.{nameof(SquadResponseConventions.DeclaredConcealedProblemStatuses)}",
            SquadResponseConventions.DeclaredConcealedProblemStatuses,
            code => SquadErrorResults.ToHttpResult(
                new PitchMate.Domain.Squads.SquadError(code, DiagnosticMessage), concealExistence: true),
            ($"{nameof(SquadErrorResults)}.{nameof(SquadErrorResults.Unauthenticated)}()",
                SquadErrorResults.Unauthenticated())),

        // Stats — wholly concealing, hence one variant, and the one that declares no 401.
        Variant<PitchMate.Application.Stats.StatsErrorCode>(
            nameof(StatsErrorResults),
            Standard,
            $"{nameof(StatsResponseConventions)}.{nameof(StatsResponseConventions.DeclaredProblemStatuses)}",
            StatsResponseConventions.DeclaredProblemStatuses,
            code => StatsErrorResults.ToHttpResult(
                new PitchMate.Application.Stats.StatsError(code, DiagnosticMessage)),
            ($"{nameof(StatsErrorResults)}.{nameof(StatsErrorResults.Concealed)}()",
                StatsErrorResults.Concealed())),

        // Notifications — the ordinary mapping.
        Variant<PitchMate.Domain.Notifications.NotificationErrorCode>(
            nameof(NotificationErrorResults),
            Standard,
            $"{nameof(NotificationResponseConventions)}.{nameof(NotificationResponseConventions.DeclaredProblemStatuses)}",
            NotificationResponseConventions.DeclaredProblemStatuses,
            code => NotificationErrorResults.ToHttpResult(
                new PitchMate.Domain.Notifications.NotificationError(code, DiagnosticMessage)),
            ($"{nameof(NotificationErrorResults)}.{nameof(NotificationErrorResults.Unauthenticated)}()",
                NotificationErrorResults.Unauthenticated())),

        // Notifications — the existence-sensitive reads. The seam has no concealment flag because the
        // handlers conceal before it is reached, so the emissions are the same set; driving the variant
        // keeps that a measured fact rather than a comment.
        Variant<PitchMate.Domain.Notifications.NotificationErrorCode>(
            nameof(NotificationErrorResults),
            Concealed,
            $"{nameof(NotificationResponseConventions)}.{nameof(NotificationResponseConventions.DeclaredProblemStatuses)}",
            NotificationResponseConventions.DeclaredProblemStatuses,
            code => NotificationErrorResults.ToHttpResult(
                new PitchMate.Domain.Notifications.NotificationError(code, DiagnosticMessage)),
            ($"{nameof(NotificationErrorResults)}.{nameof(NotificationErrorResults.Unauthenticated)}()",
                NotificationErrorResults.Unauthenticated())),

        // Matches — the ordinary mapping, where an authorisation failure is a 403.
        Variant<PitchMate.Domain.Matches.MatchErrorCode>(
            nameof(MatchErrorResults),
            Standard,
            $"{nameof(MatchResponseConventions)}.{nameof(MatchResponseConventions.DeclaredProblemStatuses)}",
            MatchResponseConventions.DeclaredProblemStatuses,
            code => MatchErrorResults.ToHttpResult(
                new PitchMate.Domain.Matches.MatchError(code, DiagnosticMessage)),
            ($"{nameof(MatchErrorResults)}.{nameof(MatchErrorResults.Unauthenticated)}()",
                MatchErrorResults.Unauthenticated())),

        // Matches — the existence-sensitive reads, where that authorisation failure becomes a 404.
        Variant<PitchMate.Domain.Matches.MatchErrorCode>(
            nameof(MatchErrorResults),
            Concealed,
            $"{nameof(MatchResponseConventions)}.{nameof(MatchResponseConventions.DeclaredConcealedProblemStatuses)}",
            MatchResponseConventions.DeclaredConcealedProblemStatuses,
            code => MatchErrorResults.ToHttpResult(
                new PitchMate.Domain.Matches.MatchError(code, DiagnosticMessage), concealExistence: true),
            ($"{nameof(MatchErrorResults)}.{nameof(MatchErrorResults.Unauthenticated)}()",
                MatchErrorResults.Unauthenticated())),

        // Live tracking — the ordinary mapping. This seam conceals unconditionally, so both variants
        // share a declared set; both are driven for the same reason as notifications.
        Variant<PitchMate.Domain.LiveTracking.LiveTrackingErrorCode>(
            nameof(LiveTrackingErrorResults),
            Standard,
            $"{nameof(LiveTrackingResponseConventions)}.{nameof(LiveTrackingResponseConventions.DeclaredProblemStatuses)}",
            LiveTrackingResponseConventions.DeclaredProblemStatuses,
            code => LiveTrackingErrorResults.ToHttpResult(
                new PitchMate.Domain.LiveTracking.LiveTrackingError(code, DiagnosticMessage)),
            ($"{nameof(LiveTrackingErrorResults)}.{nameof(LiveTrackingErrorResults.Unauthenticated)}()",
                LiveTrackingErrorResults.Unauthenticated()),
            ($"{nameof(LiveTrackingErrorResults)}.{nameof(LiveTrackingErrorResults.Concealed)}()",
                LiveTrackingErrorResults.Concealed())),

        // Live tracking — the existence-sensitive endpoints.
        Variant<PitchMate.Domain.LiveTracking.LiveTrackingErrorCode>(
            nameof(LiveTrackingErrorResults),
            Concealed,
            $"{nameof(LiveTrackingResponseConventions)}.{nameof(LiveTrackingResponseConventions.DeclaredProblemStatuses)}",
            LiveTrackingResponseConventions.DeclaredProblemStatuses,
            code => LiveTrackingErrorResults.ToHttpResult(
                new PitchMate.Domain.LiveTracking.LiveTrackingError(code, DiagnosticMessage)),
            ($"{nameof(LiveTrackingErrorResults)}.{nameof(LiveTrackingErrorResults.Unauthenticated)}()",
                LiveTrackingErrorResults.Unauthenticated()),
            ($"{nameof(LiveTrackingErrorResults)}.{nameof(LiveTrackingErrorResults.Concealed)}()",
                LiveTrackingErrorResults.Concealed())),
    ];

    /// <summary>
    /// Builds one seam variant by driving every member of <typeparamref name="TCode"/> — as reflection
    /// reports them — through <paramref name="produce"/>, then appending the seam's fixed results.
    /// </summary>
    /// <typeparam name="TCode">The seam's error-code enum.</typeparam>
    /// <param name="seamName">The seam class name.</param>
    /// <param name="variantName">The variant name.</param>
    /// <param name="conventionName">The convention member the declared set is read from.</param>
    /// <param name="declaredStatuses">That convention's declared problem set.</param>
    /// <param name="produce">Calls the seam for one error code, in this variant's manner.</param>
    /// <param name="fixedResults">The seam's code-independent results, each with a name.</param>
    /// <returns>The measured seam variant.</returns>
    private static ErrorSeamVariant Variant<TCode>(
        string seamName,
        string variantName,
        string conventionName,
        IReadOnlyList<int> declaredStatuses,
        Func<TCode, IResult> produce,
        params (string Producer, IResult Result)[] fixedResults)
        where TCode : struct, Enum
    {
        List<SeamEmission> emissions =
        [
            .. Enum.GetValues<TCode>()
                .Select(code => new SeamEmission(
                    seamName, variantName, $"{typeof(TCode).Name}.{code}", StatusOf(produce(code)))),
            .. fixedResults
                .Select(fixedResult => new SeamEmission(
                    seamName, variantName, fixedResult.Producer, StatusOf(fixedResult.Result))),
        ];

        return new ErrorSeamVariant(
            seamName, variantName, conventionName, typeof(TCode), declaredStatuses, emissions);
    }

    /// <summary>Reads the status a minimal-API <see cref="IResult"/> will write to the response.</summary>
    private static int StatusOf(IResult result) =>
        result is IStatusCodeHttpResult { StatusCode: { } statusCode }
            ? statusCode
            : throw new InvalidOperationException(
                $"The seam returned a {result.GetType().Name}, which carries no status code to check.");
}

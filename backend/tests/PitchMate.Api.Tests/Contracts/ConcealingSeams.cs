using PitchMate.Api.LiveTracking.Endpoints;
using PitchMate.Api.Matches.Endpoints;
using PitchMate.Api.Notifications.Endpoints;
using PitchMate.Api.Squads.Endpoints;
using PitchMate.Api.Stats.Endpoints;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// The five concealing seams and, for each, the distinct failures its not-found masks — the subject of
/// the Concealment_Guard.
/// <para>
/// A concealed not-found exists to make two different answers look like one. "You are not a member of
/// that squad" and "there is no such squad" have to be the same response, or the difference between
/// them is an oracle for enumerating squads, matches and players. The guarantee therefore lives in the
/// <i>bytes</i>, not in the status: two <c>404</c>s with different titles conceal nothing.
/// </para>
/// <para>
/// Every entry below calls the real seam. Nothing is restated: each failure is produced by the same
/// method the endpoints call, so a seam that starts deriving its concealed body from the error's
/// <c>Code</c> or <c>Message</c> is caught here rather than in review. That is also why each failure
/// carries its own distinct <see cref="ConcealedFailure.Cause"/> text — see the remarks on that type.
/// </para>
/// <para>
/// Where concealment happens differs by subsystem, and the catalogue reflects that rather than
/// flattening it. Stats and live tracking conceal at the seam: two error codes route through one fixed
/// <c>Concealed()</c> result. Squads and matches conceal at the seam too, but only on an
/// existence-sensitive read, so their failures are driven with <c>concealExistence: true</c>.
/// Notifications and the squad/match authorisation gates conceal one layer <i>in</i> — the Application
/// layer collapses several causes onto one error with one uniform message before the seam sees it — so
/// for those the distinct failures are distinct <i>causes</i> presented under the same code. All of
/// them must come out identical, and none may carry a <c>code</c> extension.
/// </para>
/// <para>
/// <see cref="DisclosingControls"/> holds the other half: one genuinely code-echoing result per seam.
/// Those are what the guard's controls use to show that the comparison and the <c>code</c> walk
/// discriminate, rather than reporting every response clean.
/// </para>
/// </summary>
public static class ConcealingSeams
{
    /// <summary>The number of concealing seams the design declares, used as the non-vacuity floor.</summary>
    public const int DeclaredConcealingSeamCount = 5;

    /// <summary>
    /// The smallest number of distinct concealed failures any one seam must contribute. Below two there
    /// is no pair to compare and the guard would pass over that seam in silence.
    /// </summary>
    public const int MinimumConcealedFailuresPerSeam = 3;

    private const string NotAMemberCause = "the caller holds no membership of the target's squad";
    private const string NoSuchTargetCause = "the target does not exist at all";
    private const string InactiveMembershipCause = "the caller's membership is inactive";
    private const string ResidualTokenCause = "the access token was missing, malformed or expired";
    private const string DiagnosticMessage = "diagnostic detail only";

    /// <summary>
    /// Every concealed failure of every concealing seam, grouped by seam in the order the seams are
    /// declared.
    /// </summary>
    public static IReadOnlyList<ConcealedFailure> All { get; } = Discover();

    /// <summary>The distinct concealing seam names discovered, for the non-vacuity floor.</summary>
    public static IReadOnlyList<string> SeamNames { get; } =
        [.. All.Select(static failure => failure.SeamName).Distinct(StringComparer.Ordinal)];

    /// <summary>
    /// One genuinely disclosing result per seam: a real failure of that same seam which <i>does</i>
    /// echo its stable code, because it is not a concealed not-found. The guard's controls require the
    /// rule to report each of these, which is what stops the rule from being satisfiable by any body at
    /// all.
    /// </summary>
    public static IReadOnlyList<ConcealedFailure> DisclosingControls { get; } =
    [
        new(
            nameof(SquadErrorResults),
            $"{nameof(PitchMate.Domain.Squads.SquadErrorCode)}.{PitchMate.Domain.Squads.SquadErrorCode.NotAMember}",
            "a target membership that does not resolve — a genuine not-found, not a concealed one",
            static () => SquadErrorResults.ToHttpResult(
                new PitchMate.Domain.Squads.SquadError(
                    PitchMate.Domain.Squads.SquadErrorCode.NotAMember, DiagnosticMessage))),

        new(
            nameof(MatchErrorResults),
            $"{nameof(PitchMate.Domain.Matches.MatchErrorCode)}.{PitchMate.Domain.Matches.MatchErrorCode.NotAParticipant}",
            "a target membership that is not a participant — a genuine not-found, not a concealed one",
            static () => MatchErrorResults.ToHttpResult(
                new PitchMate.Domain.Matches.MatchError(
                    PitchMate.Domain.Matches.MatchErrorCode.NotAParticipant, DiagnosticMessage))),

        new(
            nameof(NotificationErrorResults),
            $"{nameof(PitchMate.Domain.Notifications.NotificationErrorCode)}.{PitchMate.Domain.Notifications.NotificationErrorCode.ValidationFailed}",
            "a client input failure, which is branchable and so carries its code",
            static () => NotificationErrorResults.ToHttpResult(
                new PitchMate.Domain.Notifications.NotificationError(
                    PitchMate.Domain.Notifications.NotificationErrorCode.ValidationFailed, DiagnosticMessage))),

        new(
            nameof(StatsErrorResults),
            $"{nameof(PitchMate.Application.Stats.StatsErrorCode)}.{PitchMate.Application.Stats.StatsErrorCode.UnsupportedStatistic}",
            "an unsupported ranking statistic, which is branchable and so carries its code",
            static () => StatsErrorResults.ToHttpResult(
                new PitchMate.Application.Stats.StatsError(
                    PitchMate.Application.Stats.StatsErrorCode.UnsupportedStatistic, DiagnosticMessage))),

        new(
            nameof(LiveTrackingErrorResults),
            $"{nameof(PitchMate.Domain.LiveTracking.LiveTrackingErrorCode)}.{PitchMate.Domain.LiveTracking.LiveTrackingErrorCode.LogSealed}",
            "a sealed match log, which is branchable and so carries its code",
            static () => LiveTrackingErrorResults.ToHttpResult(
                new PitchMate.Domain.LiveTracking.LiveTrackingError(
                    PitchMate.Domain.LiveTracking.LiveTrackingErrorCode.LogSealed, DiagnosticMessage))),
    ];

    private static IReadOnlyList<ConcealedFailure> Discover() =>
    [
        // Squads — the existence-sensitive reads (a squad's data, its feature flags). SquadAuthorization
        // collapses non-member, inactive, guest and absent-squad onto one uniform Unauthorized, which
        // the concealing seam path answers with its fixed 404. The three causes below are what that
        // collapse hides, presented here with deliberately different diagnostic text.
        SquadConcealed(NotAMemberCause),
        SquadConcealed(NoSuchTargetCause),
        SquadConcealed(InactiveMembershipCause),
        new(
            nameof(SquadErrorResults),
            $"{nameof(SquadErrorResults)}.{nameof(SquadErrorResults.Concealed)}()",
            ResidualTokenCause,
            SquadErrorResults.Concealed),

        // Matches — the existence-sensitive reads (availability tally, team sheet), concealing the same
        // three causes about the match's squad.
        MatchConcealed(NotAMemberCause),
        MatchConcealed(NoSuchTargetCause),
        MatchConcealed(InactiveMembershipCause),
        new(
            nameof(MatchErrorResults),
            $"{nameof(MatchErrorResults)}.{nameof(MatchErrorResults.Concealed)}()",
            ResidualTokenCause,
            MatchErrorResults.Concealed),

        // Notifications — concealment happens in the handlers: NotificationAuthorization reports a
        // record that does not exist, one not backed by the caller, and an inaccessible squad scope as
        // the same NotFound, so these are three causes under one code.
        NotificationConcealed("the record does not exist"),
        NotificationConcealed("the record is not backed by the caller"),
        NotificationConcealed("the squad scope is inaccessible to the caller"),
        new(
            nameof(NotificationErrorResults),
            $"{nameof(NotificationErrorResults)}.{nameof(NotificationErrorResults.Concealed)}()",
            ResidualTokenCause,
            NotificationErrorResults.Concealed),

        // Stats — wholly concealing: two distinct codes route through one fixed result, and the endpoint
        // edge calls that result directly for a missing or unusable token, which is why the stats
        // endpoints declare no 401.
        new(
            nameof(StatsErrorResults),
            $"{nameof(PitchMate.Application.Stats.StatsErrorCode)}.{PitchMate.Application.Stats.StatsErrorCode.Unauthorized}",
            NotAMemberCause,
            static () => StatsErrorResults.ToHttpResult(
                new PitchMate.Application.Stats.StatsError(
                    PitchMate.Application.Stats.StatsErrorCode.Unauthorized, NotAMemberCause))),
        new(
            nameof(StatsErrorResults),
            $"{nameof(PitchMate.Application.Stats.StatsErrorCode)}.{PitchMate.Application.Stats.StatsErrorCode.NotFound}",
            NoSuchTargetCause,
            static () => StatsErrorResults.ToHttpResult(
                new PitchMate.Application.Stats.StatsError(
                    PitchMate.Application.Stats.StatsErrorCode.NotFound, NoSuchTargetCause))),
        new(
            nameof(StatsErrorResults),
            $"{nameof(StatsErrorResults)}.{nameof(StatsErrorResults.Concealed)}()",
            ResidualTokenCause,
            StatsErrorResults.Concealed),

        // Live tracking — wholly concealing in the same way: two codes, one fixed result.
        new(
            nameof(LiveTrackingErrorResults),
            $"{nameof(PitchMate.Domain.LiveTracking.LiveTrackingErrorCode)}.{PitchMate.Domain.LiveTracking.LiveTrackingErrorCode.Unauthorized}",
            NotAMemberCause,
            static () => LiveTrackingErrorResults.ToHttpResult(
                new PitchMate.Domain.LiveTracking.LiveTrackingError(
                    PitchMate.Domain.LiveTracking.LiveTrackingErrorCode.Unauthorized, NotAMemberCause))),
        new(
            nameof(LiveTrackingErrorResults),
            $"{nameof(PitchMate.Domain.LiveTracking.LiveTrackingErrorCode)}.{PitchMate.Domain.LiveTracking.LiveTrackingErrorCode.NotFound}",
            NoSuchTargetCause,
            static () => LiveTrackingErrorResults.ToHttpResult(
                new PitchMate.Domain.LiveTracking.LiveTrackingError(
                    PitchMate.Domain.LiveTracking.LiveTrackingErrorCode.NotFound, NoSuchTargetCause))),
        new(
            nameof(LiveTrackingErrorResults),
            $"{nameof(LiveTrackingErrorResults)}.{nameof(LiveTrackingErrorResults.Concealed)}()",
            ResidualTokenCause,
            LiveTrackingErrorResults.Concealed),
    ];

    private static ConcealedFailure SquadConcealed(string cause) =>
        new(
            nameof(SquadErrorResults),
            $"{nameof(PitchMate.Domain.Squads.SquadErrorCode)}.{PitchMate.Domain.Squads.SquadErrorCode.Unauthorized}"
                + " (concealed)",
            cause,
            () => SquadErrorResults.ToHttpResult(
                new PitchMate.Domain.Squads.SquadError(
                    PitchMate.Domain.Squads.SquadErrorCode.Unauthorized, cause),
                concealExistence: true));

    private static ConcealedFailure MatchConcealed(string cause) =>
        new(
            nameof(MatchErrorResults),
            $"{nameof(PitchMate.Domain.Matches.MatchErrorCode)}.{PitchMate.Domain.Matches.MatchErrorCode.Unauthorized}"
                + " (concealed)",
            cause,
            () => MatchErrorResults.ToHttpResult(
                new PitchMate.Domain.Matches.MatchError(
                    PitchMate.Domain.Matches.MatchErrorCode.Unauthorized, cause),
                concealExistence: true));

    private static ConcealedFailure NotificationConcealed(string cause) =>
        new(
            nameof(NotificationErrorResults),
            $"{nameof(PitchMate.Domain.Notifications.NotificationErrorCode)}.{PitchMate.Domain.Notifications.NotificationErrorCode.NotFound}",
            cause,
            () => NotificationErrorResults.ToHttpResult(
                new PitchMate.Domain.Notifications.NotificationError(
                    PitchMate.Domain.Notifications.NotificationErrorCode.NotFound, cause)));
}

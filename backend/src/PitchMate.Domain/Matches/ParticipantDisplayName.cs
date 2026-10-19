using PitchMate.Domain.Squads;

namespace PitchMate.Domain.Matches;

/// <summary>
/// The single display-name-at-time rule every match read obeys: the
/// <see cref="MatchParticipant.DisplayName"/> captured when the participant was added, except where
/// the squad membership behind it cannot be resolved or has since been anonymised, in which case the
/// fixed, non-identifying <see cref="SquadMembership.DisplayNamePlaceholder"/> is reported instead
/// (Requirements 2.13, 4.6, 4.7, 10.7).
/// <para>
/// Stating the rule once, here, is what keeps every surface that reports a display-name-at-time in
/// step: the match detail's participant view, the working teams' roster entry, and the team sheet's
/// roster all resolve the same identity to the same name. It is simultaneously the
/// <em>specification</em> of the rule and the <em>oracle</em> the equivalent SQL <c>CASE</c> in each
/// EF query source is validated against.
/// </para>
/// <para>
/// <see cref="Resolve"/> is pure — a value in, a value out: no mutation, no clock, no randomness and
/// no I/O — so it is safe to evaluate from Domain, from a query source, and from a test oracle alike.
/// </para>
/// </summary>
/// <remarks>
/// Anonymisation must be decided by <see cref="SquadMembership.DisplayNameNormalized"/> being
/// <see langword="null"/>, which only <see cref="SquadMembership.Anonymise"/> sets. Comparing
/// <see cref="SquadMembership.DisplayName"/> to <see cref="SquadMembership.DisplayNamePlaceholder"/>
/// is <em>not</em> a sound detector: a live membership may legitimately be named "Former player", and
/// its normalised name would then be "former player" rather than <see langword="null"/>.
/// </remarks>
public static class ParticipantDisplayName
{
    /// <summary>
    /// Resolves the display-name-at-time to report for one rostered or participating squad-membership
    /// identity.
    /// </summary>
    /// <param name="capturedName">
    /// The display name captured on the match's <see cref="MatchParticipant"/> for that identity, or
    /// <see langword="null"/> where none was captured.
    /// </param>
    /// <param name="membershipResolved">
    /// <see langword="true"/> when the identity resolves to a squad-membership row the read can see;
    /// <see langword="false"/> when it resolves to none — covering a rostered identity the match holds
    /// no participant for, and a membership row that is absent or soft-deleted.
    /// </param>
    /// <param name="isAnonymised">
    /// <see langword="true"/> when the resolved membership has been anonymised, decided by its
    /// <see cref="SquadMembership.DisplayNameNormalized"/> being <see langword="null"/>.
    /// </param>
    /// <returns>
    /// <paramref name="capturedName"/> when the membership is resolved, is not anonymised, and the
    /// captured name is neither <see langword="null"/> nor whitespace; otherwise
    /// <see cref="SquadMembership.DisplayNamePlaceholder"/>.
    /// </returns>
    public static string Resolve(string? capturedName, bool membershipResolved, bool isAnonymised) =>
        !membershipResolved || isAnonymised || string.IsNullOrWhiteSpace(capturedName)
            ? SquadMembership.DisplayNamePlaceholder
            : capturedName;
}

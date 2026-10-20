namespace PitchMate.Api.Tests.Matches;

/// <summary>
/// Who sends the mismatched-squad request. All three are authenticated with an accepted access token
/// carrying a resolvable subject, because the byte-identity guarantee covers authenticated,
/// subject-resolved callers only — a missing or rejected token produces the framework's <c>401</c> and is
/// not part of the concealment contract.
/// <para>
/// The three stand for genuinely different amounts of standing, which is the point: the refusal must not
/// vary with how much authority the caller holds elsewhere.
/// </para>
/// </summary>
public enum MismatchCaller
{
    /// <summary>
    /// An active <c>Owner</c> of the <em>match's</em> squad — a caller every one of the six would serve
    /// had the path named the match's own squad. The mismatch is then the only thing refusing them.
    /// </summary>
    OrganiserOfMatchSquad,

    /// <summary>
    /// The sharp case: an active <c>Owner</c> of the squad named in the <em>path</em>, holding no
    /// membership whatever of the match's squad. Owning the squad in the URL must grant nothing, or
    /// binding a caller-supplied squad id would be an authorisation input (Requirement 7.6).
    /// </summary>
    OwnerOfThePathSquadOnly,

    /// <summary>A registered user holding no membership in any squad.</summary>
    NoMembershipAnywhere,
}

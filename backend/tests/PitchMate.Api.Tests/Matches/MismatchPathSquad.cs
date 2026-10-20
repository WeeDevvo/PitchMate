namespace PitchMate.Api.Tests.Matches;

/// <summary>
/// Which kind of <em>not-the-match's</em> squad the request path names. Both kinds must be refused
/// identically, and for a reason worth separating: an identity no squad row carries exercises "the squad
/// does not exist", while a real squad the caller may even own exercises "the squad exists, but it is not
/// this match's" — the case a reader is most likely to assume is harmless.
/// </summary>
public enum MismatchPathSquad
{
    /// <summary>An arbitrary generated GUID, overwhelmingly a squad that does not exist.</summary>
    ArbitraryIdentity,

    /// <summary>A second, genuinely persisted squad — one the caller may hold an <c>Owner</c> membership of.</summary>
    AnotherRealSquad,
}

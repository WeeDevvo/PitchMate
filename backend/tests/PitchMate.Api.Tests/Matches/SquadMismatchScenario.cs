namespace PitchMate.Api.Tests.Matches;

/// <summary>
/// One generated case of Property 18: which of the six operations to call, who calls it, and what kind of
/// not-the-match's squad the path names.
/// <para>
/// <see cref="ArbitrarySquadId"/> is carried rather than drawn at use time so a shrunk counterexample
/// names the exact identity that failed. It is consumed only when
/// <see cref="PathSquad"/> is <see cref="MismatchPathSquad.ArbitraryIdentity"/>; the fixture substitutes
/// the second real squad in the (vanishingly unlikely) event that a generated GUID collides with the
/// match's own squad, so the scenario is always genuinely a mismatch.
/// </para>
/// </summary>
/// <param name="Operation">The operation under test.</param>
/// <param name="Caller">The authenticated caller sending the request.</param>
/// <param name="PathSquad">Which kind of wrong squad the path names.</param>
/// <param name="ArbitrarySquadId">The generated squad identity, used by <see cref="MismatchPathSquad.ArbitraryIdentity"/>.</param>
public sealed record SquadMismatchScenario(
    SquadScopedMatchOperation Operation,
    MismatchCaller Caller,
    MismatchPathSquad PathSquad,
    Guid ArbitrarySquadId)
{
    /// <summary>A short, readable form for FsCheck's distribution output and failure labels.</summary>
    public override string ToString() => $"{Operation} as {Caller} against {PathSquad}";
}

using Microsoft.AspNetCore.Http;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// One failure a concealing seam masks behind its not-found, described by the seam it belongs to, a
/// name for the thing that produces it, the underlying cause it stands for, and a delegate that calls
/// the real seam to produce the result.
/// <para>
/// The <paramref name="Cause"/> is deliberately a <i>distinct</i> diagnostic string per failure. The
/// Application layer already collapses the causes it conceals onto one error with one uniform message,
/// so handing the seam the same message twice would make byte-identity trivially true and would pass
/// over the mistake that matters — a seam that starts echoing the error's <c>Message</c> or
/// <c>Code</c> into the concealed body. Giving each failure its own cause text means identity can only
/// hold because the body is genuinely fixed.
/// </para>
/// </summary>
/// <param name="SeamName">The seam class whose concealing path produces this result.</param>
/// <param name="Producer">A name for the producing call, for failure messages.</param>
/// <param name="Cause">The distinct underlying cause this failure stands for.</param>
/// <param name="Produce">Calls the real seam to produce the concealed result.</param>
public sealed record ConcealedFailure(
    string SeamName,
    string Producer,
    string Cause,
    Func<IResult> Produce)
{
    /// <summary>A readable form for failure messages and FsCheck's distribution output.</summary>
    public override string ToString() => $"{SeamName} via {Producer}";
}

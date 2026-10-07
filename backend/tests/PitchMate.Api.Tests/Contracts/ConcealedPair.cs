namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// Two distinct failures a single concealing seam masks behind the same not-found, paired so the guard
/// can assert they are indistinguishable.
/// <para>
/// Pairs are formed <i>within</i> a seam and never across seams. Concealment is a promise about one
/// endpoint answering two questions identically; two different endpoints answering differently is not a
/// leak, so pairing across seams would assert something the requirement does not ask for and would
/// couple unrelated subsystems' bodies together.
/// </para>
/// </summary>
/// <param name="SeamName">The seam both failures belong to.</param>
/// <param name="Left">One captured concealed response.</param>
/// <param name="Right">The other captured concealed response.</param>
public sealed record ConcealedPair(string SeamName, CapturedResponse Left, CapturedResponse Right)
{
    /// <summary>A readable form for failure messages and FsCheck's distribution output.</summary>
    public override string ToString() =>
        $"{SeamName}: {Left.Failure.Producer} ({Left.Failure.Cause}) "
            + $"vs {Right.Failure.Producer} ({Right.Failure.Cause})";
}

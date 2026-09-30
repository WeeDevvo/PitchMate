namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// One HTTP status an error seam can actually emit, paired with the producer that emits it — an error
/// code driven through the seam's mapping table, or one of the seam's fixed results (its uniform
/// unauthenticated result, or its concealed not-found).
/// <para>
/// The producer name is carried so a coverage failure can name <i>what</i> produced the undeclared
/// status rather than only the number (Requirement 3.6).
/// </para>
/// </summary>
/// <param name="Seam">The seam class that produced the status, for example <c>SquadErrorResults</c>.</param>
/// <param name="Variant">
/// The seam variant the status was produced under — the ordinary mapping, or the existence-concealing
/// one where the seam takes a concealment flag.
/// </param>
/// <param name="Producer">
/// What produced the status: <c>EnumTypeName.MemberName</c> for an error code, or
/// <c>SeamName.Method()</c> for one of the seam's fixed results.
/// </param>
/// <param name="Status">The HTTP status the seam wrote for that producer.</param>
public sealed record SeamEmission(string Seam, string Variant, string Producer, int Status)
{
    /// <summary>A readable identifier for failure messages and FsCheck classification.</summary>
    public override string ToString() => $"{Seam} ({Variant}): {Producer} -> {Status}";
}

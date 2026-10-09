namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// One error code of one seam variant, paired with the delegate that calls the real seam for it.
/// <para>
/// The call is carried as a <see cref="ConcealedFailure"/> — the shared "named seam call plus a
/// delegate" descriptor that <see cref="CapturedResponse.CaptureAsync"/> executes. Its name belongs to
/// the concealment guard that introduced it, but the shape is exactly what is needed here, and reusing
/// it means both guards execute seam results through one code path rather than two that could drift.
/// </para>
/// </summary>
/// <param name="SeamName">The seam class being called.</param>
/// <param name="VariantName">The variant the seam is being called under.</param>
/// <param name="ErrorCodeType">The error-code enum the code belongs to.</param>
/// <param name="CodeName">The error code's C# member name.</param>
/// <param name="Call">Calls the real seam for that code.</param>
public sealed record ProblemSeamCall(
    string SeamName,
    string VariantName,
    Type ErrorCodeType,
    string CodeName,
    ConcealedFailure Call)
{
    /// <summary>The seam and variant, used to group the calls for the non-vacuity floor.</summary>
    public string SeamVariant => $"{SeamName} ({VariantName})";

    /// <summary>A readable form for failure messages.</summary>
    public override string ToString() => $"{SeamVariant}: {ErrorCodeType.Name}.{CodeName}";
}

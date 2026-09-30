namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// One error seam under one of its variants: the error-code enum whose members it translates, the
/// statuses it was observed to emit when every one of those members was driven through it, and the
/// declared problem set of the response convention the endpoints it serves compose.
/// <para>
/// This is the pairing Property 3 quantifies over. The emissions are <i>measured</i> — obtained by
/// calling the real seam — while the declared set is <i>read</i> from the convention beside it, so the
/// two can only agree because they genuinely agree (Requirements 2.1, 2.2, 3.5).
/// </para>
/// </summary>
/// <param name="SeamName">The seam class name, for example <c>SquadErrorResults</c>.</param>
/// <param name="VariantName">
/// The variant name — <c>standard</c> for the ordinary mapping, <c>concealed</c> where the seam is
/// called with its existence-concealment flag set.
/// </param>
/// <param name="ConventionName">The response-convention member the declared set was read from.</param>
/// <param name="ErrorCodeType">The error-code enum this seam translates.</param>
/// <param name="DeclaredProblemStatuses">The declared problem set of the corresponding convention.</param>
/// <param name="Emissions">Every status the seam emitted, one entry per producer.</param>
public sealed record ErrorSeamVariant(
    string SeamName,
    string VariantName,
    string ConventionName,
    Type ErrorCodeType,
    IReadOnlyList<int> DeclaredProblemStatuses,
    IReadOnlyList<SeamEmission> Emissions)
{
    /// <summary>
    /// The number of error codes reflection reports for <see cref="ErrorCodeType"/>. The non-vacuity
    /// floor asserts this is non-zero and that every one of them appears among the
    /// <see cref="Emissions"/>, so a seam whose codes stopped being enumerated fails rather than
    /// passing empty (Requirement 3.8 in spirit; Property 3's floor).
    /// </summary>
    public int ErrorCodeCount => Enum.GetValues(ErrorCodeType).Length;

    /// <summary>
    /// Every emission of this variant whose status is absent from <paramref name="declaredStatuses"/>,
    /// rendered as a message naming <b>both</b> the producing error code and the undeclared status
    /// (Requirement 3.6). Empty when the declared set covers everything the seam can emit.
    /// <para>
    /// The declared set is a parameter rather than being read from
    /// <see cref="DeclaredProblemStatuses"/> so the non-vacuity control can hand this method a
    /// deliberately narrowed set and show the check fails — and fails informatively — rather than
    /// being satisfied by any set at all.
    /// </para>
    /// </summary>
    /// <param name="declaredStatuses">The declared problem set to test the emissions against.</param>
    /// <returns>One readable message per undeclared emission.</returns>
    public IReadOnlyList<string> UndeclaredEmissions(IReadOnlyList<int> declaredStatuses)
    {
        ArgumentNullException.ThrowIfNull(declaredStatuses);

        string declared = string.Join(", ", declaredStatuses.Order());

        return
        [
            .. Emissions
                .Where(emission => !declaredStatuses.Contains(emission.Status))
                .Select(emission =>
                    $"{SeamName} ({VariantName}): {emission.Producer} produces {emission.Status}, "
                        + $"which {ConventionName} does not declare (declared: {declared})"),
        ];
    }

    /// <summary>A readable identifier for failure messages and FsCheck classification.</summary>
    public override string ToString() => $"{SeamName} ({VariantName})";
}

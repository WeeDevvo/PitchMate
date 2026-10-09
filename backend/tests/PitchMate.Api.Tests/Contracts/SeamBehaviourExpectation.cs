using System.Globalization;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// One row of <see cref="SeamBehaviourBaseline"/>: the status and <c>ProblemDetails</c> body one error
/// code of one seam variant is expected to produce.
/// <para>
/// A row records the behaviour the seam had <b>before</b> this chore touched it, which is what
/// Requirement 2.12 requires preserved — unless <see cref="PreChange"/> is set, in which case the row
/// records a deliberate, decided departure and says in prose what it departed from. There is no third
/// case: a seam whose behaviour moved without a <see cref="PreChange"/> note is a regression, and the
/// guard reports it.
/// </para>
/// </summary>
/// <param name="SeamVariant">
/// The seam and variant the code was driven under, exactly as <see cref="SeamProblem.SeamVariant"/>
/// renders it — for example <c>SquadErrorResults (concealed)</c>.
/// </param>
/// <param name="CodeName">The error code's C# member name.</param>
/// <param name="Status">The HTTP status the seam is expected to write.</param>
/// <param name="Title">The problem body's <c>title</c>.</param>
/// <param name="Code">
/// The branchable <c>code</c> extension, or <see langword="null"/> where the body carries none — which
/// today is exactly the concealed not-founds (Requirements 5.2, 5.6).
/// </param>
/// <param name="FixedDetail">
/// The <c>detail</c> the seam writes regardless of the cause it was handed, where the seam substitutes
/// its own text. <see langword="null"/> means the seam echoes the error's own message, which is the
/// overwhelming majority.
/// </param>
/// <param name="PreChange">
/// <see langword="null"/> where this row <i>is</i> the pre-change behaviour. Otherwise a description of
/// what the seam produced before this chore, making the departure a visible, reviewable table entry
/// rather than a silent diff.
/// </param>
public sealed record SeamBehaviourExpectation(
    string SeamVariant,
    string CodeName,
    int Status,
    string Title,
    string? Code,
    string? FixedDetail = null,
    string? PreChange = null)
{
    /// <summary>Whether this row departs from the pre-change behaviour by an explicit decision.</summary>
    public bool IsDeviation => PreChange is not null;

    /// <summary>The key under which the row is matched to a driven seam call.</summary>
    public string Key => $"{SeamVariant}|{CodeName}";

    /// <summary>A readable form for failure messages.</summary>
    public string Description => $"{SeamVariant}: {CodeName}";

    /// <summary>
    /// The members the body is expected to carry, in the order <c>ProblemDetails</c> serialises them —
    /// <c>type</c>, <c>title</c>, <c>status</c>, <c>detail</c>, then the <c>code</c> extension. The
    /// order is part of the expectation: a reordered body is a different body on the wire.
    /// </summary>
    /// <param name="errorMessage">The message handed to the seam, echoed as <c>detail</c> unless the
    /// seam substitutes its own.</param>
    /// <returns>The expected member names and values, in order.</returns>
    public IReadOnlyList<KeyValuePair<string, string>> ExpectedMembers(string errorMessage)
    {
        ArgumentNullException.ThrowIfNull(errorMessage);

        var members = new List<KeyValuePair<string, string>>(5);

        if (SeamBehaviourBaseline.ProblemTypeUris.TryGetValue(Status, out string? typeUri))
        {
            members.Add(new KeyValuePair<string, string>("type", typeUri));
        }

        members.Add(new KeyValuePair<string, string>("title", Title));
        members.Add(new KeyValuePair<string, string>(
            "status", Status.ToString(CultureInfo.InvariantCulture)));
        members.Add(new KeyValuePair<string, string>("detail", FixedDetail ?? errorMessage));

        if (Code is not null)
        {
            members.Add(new KeyValuePair<string, string>("code", Code));
        }

        return members;
    }

    /// <summary>A readable form for failure messages and FsCheck's distribution output.</summary>
    public override string ToString() =>
        $"{Description} => {Status} title '{Title}'"
            + (Code is null ? ", no code" : $", code '{Code}'")
            + (FixedDetail is null ? string.Empty : $", fixed detail '{FixedDetail}'");
}

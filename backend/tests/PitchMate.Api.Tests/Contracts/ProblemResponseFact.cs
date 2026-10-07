namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// One declared problem response of the emitted OpenAPI document, reduced to what it is and which
/// schema it says its body has.
/// </summary>
/// <param name="Path">The path template the response belongs to.</param>
/// <param name="Method">The operation's HTTP method, upper-cased.</param>
/// <param name="Status">The declared status.</param>
/// <param name="MediaType">
/// The media type the schema was read from, or <see langword="null"/> when the response declares no
/// content at all.
/// </param>
/// <param name="SchemaIdentity">
/// A stable identity for the declared body schema: the <c>$ref</c> target where the response
/// references a component, the inlined schema's raw JSON prefixed with <c>inline:</c> where it does
/// not, and <see langword="null"/> where no schema is declared.
/// <para>
/// Identifying an inlined schema by its text rather than ignoring it matters: "every problem response
/// references the one problem schema" has to fail when one operation inlines a bespoke body, and that
/// defect is invisible to a check that only compares <c>$ref</c> targets.
/// </para>
/// </param>
public sealed record ProblemResponseFact(
    string Path,
    string Method,
    int Status,
    string? MediaType,
    string? SchemaIdentity)
{
    /// <summary>The prefix marking an identity derived from an inlined schema rather than a reference.</summary>
    public const string InlinePrefix = "inline:";

    /// <summary>What a failure message has to name for the offending response to be findable.</summary>
    public string Description => MediaType is null
        ? $"{Method} {Path} ({Status})"
        : $"{Method} {Path} ({Status} {MediaType})";

    /// <summary>A readable form for failure messages and FsCheck's distribution output.</summary>
    public override string ToString() => $"{Description} -> {SchemaIdentity ?? "no schema"}";
}

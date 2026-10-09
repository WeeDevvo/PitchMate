namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// One enumerating schema found on the part of the emitted OpenAPI document that is reachable from a
/// declared response contract or a request body, reduced to what the enum rule needs to judge it.
/// </summary>
/// <param name="Origin">
/// Where in the document the schema sits — <c>components/schemas/SquadRole</c> for a named component
/// schema, or a pointer-like path ending inside a contract when the schema is inlined. A failure
/// message quotes this so the offending schema is findable in the emitted document.
/// </param>
/// <param name="SchemaName">
/// The component name the schema is defined under, or <see langword="null"/> when the schema is
/// inlined rather than named. Requirement 4.4 asks for a <i>named</i> schema per wire enum, so an
/// inlined enumeration is itself an offence — and one a rule keyed only on component names would
/// never see.
/// </param>
/// <param name="TypeKeyword">
/// The schema's <c>type</c> keyword: the single value where it is a string, the values joined with
/// <c>|</c> where it is an array, and <see langword="null"/> where the keyword is absent.
/// <para>
/// Absent is the normal case here. .NET 10's schema exporter describes a by-name enum purely by its
/// enumerated values — <c>{"enum":["Owner","Admin","Member"]}</c> — and emits no <c>type</c> keyword
/// at all. The keyword is still read, because <c>{"type":"integer"}</c> appearing on one is exactly
/// the regression this fact exists to catch.
/// </para>
/// </param>
/// <param name="StringValues">The enumerated values that are JSON strings, in document order.</param>
/// <param name="AllowsNull">Whether <c>null</c> is one of the enumerated values.</param>
/// <param name="OtherValues">
/// The raw text of every enumerated value that is neither a JSON string nor <c>null</c> — a number
/// among them means the enum crosses the wire as an integer after all.
/// </param>
/// <param name="RawText">The schema's raw JSON, quoted in failure messages.</param>
public sealed record EnumSchemaFact(
    string Origin,
    string? SchemaName,
    string? TypeKeyword,
    IReadOnlyList<string> StringValues,
    bool AllowsNull,
    IReadOnlyList<string> OtherValues,
    string RawText)
{
    /// <summary>What a failure message has to name for the offending schema to be findable.</summary>
    public string Description => SchemaName is null
        ? $"the unnamed enum schema inlined at {Origin}"
        : $"enum schema '{SchemaName}' ({Origin})";

    /// <summary>The count of enumerated values, however they are typed.</summary>
    public int ValueCount => StringValues.Count + OtherValues.Count + (AllowsNull ? 1 : 0);

    /// <summary>A readable form for failure messages and FsCheck's distribution output.</summary>
    public override string ToString() => $"{Description} -> {RawText}";
}

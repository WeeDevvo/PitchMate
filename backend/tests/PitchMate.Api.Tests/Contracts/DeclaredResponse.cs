namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// One response an endpoint declares as metadata: the status, and the body type declared for it if any.
/// <para>
/// A declaration with no body is normalised to <see langword="null"/>. The framework writes a bodiless
/// <c>.Produces(204)</c> as <c>typeof(void)</c> rather than as a null type, so both forms have to read
/// the same way here or the "<c>204</c> carries no body type" rule would depend on which overload the
/// endpoint happened to call.
/// </para>
/// </summary>
/// <param name="Status">The declared HTTP status code.</param>
/// <param name="BodyType">The declared body type, or <see langword="null"/> when the status carries none.</param>
public sealed record DeclaredResponse(int Status, Type? BodyType)
{
    /// <summary>Whether this declaration is a success response.</summary>
    public bool IsSuccess => Status is >= 200 and <= 299;

    /// <summary>Whether this declaration states a body type.</summary>
    public bool CarriesBodyType => BodyType is not null;

    /// <summary>A readable form for failure messages.</summary>
    public override string ToString() =>
        $"{Status} {(BodyType is null ? "(no body)" : BodyType.Name)}";
}

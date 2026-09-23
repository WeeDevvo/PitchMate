namespace PitchMate.Api.Tests.Serialisation;

/// <summary>
/// One member of one wire enum, as reflection reports it: the enum type, the exact C# member name
/// (which is the wire vocabulary), and the boxed member value.
/// </summary>
/// <param name="EnumType">The wire enum type the member belongs to.</param>
/// <param name="Name">The exact C# member name, with no naming transformation applied.</param>
/// <param name="Value">The boxed enum value, obtained by parsing <paramref name="Name"/>.</param>
public sealed record WireEnumMember(Type EnumType, string Name, object Value)
{
    /// <summary>A readable identifier for failure messages and FsCheck classification.</summary>
    public override string ToString() => $"{EnumType.Name}.{Name}";
}

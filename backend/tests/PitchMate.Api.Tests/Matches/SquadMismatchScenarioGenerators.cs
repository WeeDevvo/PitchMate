using FsCheck;
using FsCheck.Fluent;

namespace PitchMate.Api.Tests.Matches;

/// <summary>
/// FsCheck arbitraries for <see cref="SquadMismatchScenario"/>.
/// <para>
/// The three axes are drawn uniformly and independently, so the generated space is the full cross product
/// — all six operations against all three callers against both kinds of wrong squad — rather than a
/// diagonal through it. That matters because the interesting cases are the corners: an <c>Owner</c> of a
/// <em>real</em> squad named in the path is the combination a reader is most tempted to think should be
/// allowed.
/// </para>
/// <para>
/// The squad identity is built from four generated 32-bit words rather than
/// <c>Guid.NewGuid()</c> so FsCheck owns the randomness and can shrink and replay a counterexample. The
/// operation, caller and wrong-squad axes are drawn from <c>Enum.GetValues</c> rather than from a literal
/// list, so a seventh operation added to <see cref="SquadScopedMatchOperation"/> is swept automatically.
/// </para>
/// </summary>
public static class SquadMismatchScenarioGenerators
{
    /// <summary>Arbitrary for a single mismatched-squad scenario.</summary>
    /// <returns>The arbitrary FsCheck.Xunit resolves for the property's parameter.</returns>
    public static Arbitrary<SquadMismatchScenario> SquadMismatchScenario() => Arb.From(ScenarioGen());

    private static Gen<SquadMismatchScenario> ScenarioGen() =>
        from operation in Gen.Elements(Enum.GetValues<SquadScopedMatchOperation>())
        from caller in Gen.Elements(Enum.GetValues<MismatchCaller>())
        from pathSquad in Gen.Elements(Enum.GetValues<MismatchPathSquad>())
        from squadId in SquadIdentityGen()
        select new SquadMismatchScenario(operation, caller, pathSquad, squadId);

    private static Gen<Guid> SquadIdentityGen() =>
        from a in Word()
        from b in Word()
        from c in Word()
        from d in Word()
        select Compose(a, b, c, d);

    private static Gen<int> Word() => Gen.Choose(int.MinValue, int.MaxValue);

    /// <summary>Lays four generated words into the sixteen bytes of a GUID.</summary>
    private static Guid Compose(int a, int b, int c, int d)
    {
        Span<byte> bytes = stackalloc byte[16];
        BitConverter.TryWriteBytes(bytes[..4], a);
        BitConverter.TryWriteBytes(bytes[4..8], b);
        BitConverter.TryWriteBytes(bytes[8..12], c);
        BitConverter.TryWriteBytes(bytes[12..], d);

        return new Guid(bytes);
    }
}

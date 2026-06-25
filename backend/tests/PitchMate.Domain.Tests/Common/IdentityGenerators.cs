using FsCheck;
using FsCheck.Fluent;

namespace PitchMate.Domain.Tests.Common;

/// <summary>
/// FsCheck <see cref="Gen{T}"/> factories that produce GUID inputs for the
/// <see cref="BaseEntity"/> identity property tests. The generators deliberately cover the
/// three significant classes of value called out by the persistence-foundation design:
/// the all-zero <see cref="Guid.Empty"/>, freshly-minted UUID version 7 values
/// (<see cref="Guid.CreateVersion7()"/>), and arbitrary (random-version) GUIDs.
/// </summary>
internal static class IdentityGenerators
{
    /// <summary>An arbitrary, effectively-random GUID built from four random 32-bit words.</summary>
    private static Gen<Guid> ArbitraryGuid =>
        from a in Gen.Choose(int.MinValue, int.MaxValue)
        from b in Gen.Choose(int.MinValue, int.MaxValue)
        from c in Gen.Choose(int.MinValue, int.MaxValue)
        from d in Gen.Choose(int.MinValue, int.MaxValue)
        select GuidFromInts(a, b, c, d);

    /// <summary>A freshly generated UUID version 7 (re-evaluated per sample).</summary>
    private static Gen<Guid> Version7Guid =>
        Gen.Constant(0).Select(_ => Guid.CreateVersion7());

    /// <summary>An arbitrary GUID guaranteed not to be the all-zero GUID.</summary>
    private static Gen<Guid> ArbitraryNonEmptyGuid =>
        from g in ArbitraryGuid
        select g == Guid.Empty ? Guid.CreateVersion7() : g;

    /// <summary>
    /// A non-zero GUID: an even mix of UUID version 7 values and arbitrary non-empty GUIDs.
    /// </summary>
    public static Gen<Guid> NonEmptyGuid() => Gen.OneOf(Version7Guid, ArbitraryNonEmptyGuid);

    /// <summary>
    /// Any GUID: the all-zero <see cref="Guid.Empty"/>, a UUID version 7, or an arbitrary GUID.
    /// </summary>
    public static Gen<Guid> AnyGuid() => Gen.OneOf(Gen.Constant(Guid.Empty), Version7Guid, ArbitraryGuid);

    private static Guid GuidFromInts(int a, int b, int c, int d)
    {
        var bytes = new byte[16];
        BitConverter.GetBytes(a).CopyTo(bytes, 0);
        BitConverter.GetBytes(b).CopyTo(bytes, 4);
        BitConverter.GetBytes(c).CopyTo(bytes, 8);
        BitConverter.GetBytes(d).CopyTo(bytes, 12);
        return new Guid(bytes);
    }
}

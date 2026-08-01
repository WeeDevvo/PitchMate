using FsCheck;

namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// FsCheck <see cref="Arbitrary{T}"/> registration for the squad GUID v7 + audit-fields persistence
/// property (design Property 41). Reuses the PostgreSQL-safe instant, actor, and name generators in
/// <see cref="AuditStampingGenerators"/> so the clock instant round-trips through <c>timestamptz</c>
/// exactly and the text values store unchanged. Reference from a property test with:
/// <code>[Property(Arbitrary = new[] { typeof(PersistedSquadAuditArbitraries) })]</code>
/// </summary>
public static class PersistedSquadAuditArbitraries
{
    /// <summary>
    /// Space-free alphanumeric alphabet for the squad name, so a generated name never trims to empty.
    /// The owner and guest names keep using the wider <see cref="AuditStampingGenerators.SafeName"/>
    /// alphabet because the test body prefixes them (<c>"o-"</c>/<c>"g-"</c>), guaranteeing a
    /// non-blank trimmed value; the squad name is passed to <c>Squad.Create</c> unprefixed and must be
    /// valid on its own (a whitespace-only name trims to empty and fails validation).
    /// </summary>
    private static readonly char[] SquadNameChars =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".ToCharArray();

    /// <summary>Inputs for the GUID v7 + audit-fields persistence property (design Property 41).</summary>
    public static Arbitrary<PersistedSquadAuditInput> PersistedSquadAuditInput() =>
        Arb.From(PersistedSquadAuditInputGen());

    private static Gen<PersistedSquadAuditInput> PersistedSquadAuditInputGen() =>
        from clockNow in AuditStampingGenerators.UtcInstant()
        from actor in AuditStampingGenerators.ActorId()
        from squadName in ValidSquadName()
        from ownerName in AuditStampingGenerators.SafeName()
        from guestName in AuditStampingGenerators.SafeName()
        select new PersistedSquadAuditInput(
            clockNow,
            actor,
            squadName,
            ownerName,
            guestName,
            Guid.NewGuid());

    /// <summary>
    /// A valid squad name (1..40 non-blank alphanumeric characters) that satisfies
    /// <c>Squad.Create</c>'s validation: never blank, never trims to empty, and well within the
    /// 1..80 length bound. Keeps the property exercising a range of valid names.
    /// </summary>
    private static Gen<string> ValidSquadName() =>
        from length in Gen.Choose(1, 40)
        from chars in ListOfLength(length, Gen.Elements(SquadNameChars))
        select new string(chars.ToArray());

    /// <summary>Builds a generator for a list of exactly <paramref name="length"/> items.</summary>
    private static Gen<List<T>> ListOfLength<T>(int length, Gen<T> element)
    {
        if (length <= 0)
        {
            return Gen.Constant(new List<T>());
        }

        return from head in element
               from tail in ListOfLength(length - 1, element)
               select Prepend(head, tail);
    }

    private static List<T> Prepend<T>(T head, List<T> tail)
    {
        var result = new List<T>(tail.Count + 1) { head };
        result.AddRange(tail);
        return result;
    }
}

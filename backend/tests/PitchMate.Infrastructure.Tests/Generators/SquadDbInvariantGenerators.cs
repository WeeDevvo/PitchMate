using FsCheck;

namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// FsCheck (C#) <see cref="Gen{T}"/> factories feeding the squad DB-invariant property tests
/// (task 18.5, design Properties 1, 13, 14, 30, 34, 36, 38). Names are drawn from a NUL-free,
/// space-free alphanumeric alphabet so they store unchanged in a PostgreSQL <c>text</c> column and
/// never trim to empty, and the three display names in a scenario are made pairwise distinct with a
/// short index suffix so they satisfy the squad's case-insensitive display-name uniqueness rule
/// while keeping every name within its 1..50 length bound. The grace period is constrained to the
/// accepted whole-day 1..90 range.
/// </summary>
public static class SquadDbInvariantGenerators
{
    /// <summary>Alphanumeric alphabet with no whitespace, so a generated name never trims to empty.</summary>
    private static readonly char[] NameChars =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".ToCharArray();

    /// <summary>A scenario with a valid squad name, three distinct valid display names, and a valid grace period.</summary>
    public static Gen<SquadDbScenario> ScenarioGen() =>
        from squadName in NameOfLength(1, 40)
        from ownerStem in NameOfLength(1, 20)
        from secondStem in NameOfLength(1, 20)
        from thirdStem in NameOfLength(1, 20)
        from graceDays in Gen.Choose(1, 90)
        select new SquadDbScenario(
            squadName,
            ownerStem + "-o",
            secondStem + "-s",
            thirdStem + "-t",
            graceDays);

    /// <summary>A non-empty alphanumeric name whose length is between <paramref name="min"/> and <paramref name="max"/>.</summary>
    private static Gen<string> NameOfLength(int min, int max) =>
        from length in Gen.Choose(min, max)
        from chars in ListOfLength(length, Gen.Elements(NameChars))
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

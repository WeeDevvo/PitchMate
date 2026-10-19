using System.Text.RegularExpressions;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// The rating-name matcher of match-read-models <b>Property 16</b>: a member name is split into words at
/// Pascal-case and camel-case boundaries, digits and underscores, each word lower-cased, and the name is
/// flagged <b>iff one whole word</b> is <c>mu</c>, <c>sigma</c>, <c>uncertainty</c>, <c>k</c> or
/// <c>c</c> — the identifier set the shipped player-stats structural scan rejects. So
/// <c>participantCount</c> and <c>kickoffLineup</c> pass while <c>mu</c>, <c>teamSigma</c> and
/// <c>uncertainty_value</c> are flagged.
/// </summary>
internal static partial class RatingNameMatcher
{
    /// <summary>The whole words that name a rating internal.</summary>
    public static readonly IReadOnlySet<string> FlaggedWords =
        new HashSet<string>(StringComparer.Ordinal) { "mu", "sigma", "uncertainty", "k", "c" };

    /// <summary>Whether <paramref name="memberName"/> contains a flagged whole word.</summary>
    public static bool IsFlagged(string memberName) =>
        Words(memberName).Any(FlaggedWords.Contains);

    /// <summary>The lower-cased words of a member name.</summary>
    public static IReadOnlyList<string> Words(string memberName)
    {
        ArgumentNullException.ThrowIfNull(memberName);

        return [.. WordPattern().Matches(memberName).Select(static match => match.Value.ToLowerInvariant())];
    }

    // An acronym run before a capitalised word, a capitalised or lower-case word, an acronym run, or a
    // digit run; underscores and anything else separate words.
    [GeneratedRegex("[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+")]
    private static partial Regex WordPattern();
}

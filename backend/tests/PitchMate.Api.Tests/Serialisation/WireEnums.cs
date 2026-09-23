using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Common;

namespace PitchMate.Api.Tests.Serialisation;

/// <summary>
/// Discovers the wire enums — the CLR enums reachable from a response contract or a request body of
/// the Api surface — by reflection over the <c>PitchMate.Domain</c> and <c>PitchMate.Application</c>
/// assemblies, and enumerates each one's members by reflection over the enum type.
/// <para>
/// Nothing here hard-codes a member. The declared set names the 17 <i>types</i> the design lists
/// (so a type being renamed, moved out of these two assemblies, or duplicated fails discovery rather
/// than quietly shrinking the guard), but every member of every discovered type comes from
/// <see cref="Enum.GetNames(Type)"/>, so a member added to any of them later is covered without this
/// file or the guards built on it being edited (Requirement 4.9).
/// </para>
/// </summary>
public static class WireEnums
{
    /// <summary>
    /// The number of wire enum types the design declares. Used as the non-vacuity floor: a discovery
    /// change that yields fewer types fails rather than passing over an empty or partial set.
    /// </summary>
    public const int DeclaredTypeCount = 17;

    /// <summary>
    /// The wire enum type names the design declares, spread across Domain (15) and Application (2).
    /// </summary>
    private static readonly string[] DeclaredTypeNames =
    [
        "SquadRole",
        "MembershipState",
        "SquadFeature",
        "InviteState",
        "SkillTier",
        "RedeemOutcome",
        "NotificationType",
        "ReadState",
        "MatchState",
        "ResultFidelity",
        "RatingState",
        "LeaderboardStatistic",
        "PlayerResult",
        "EventKind",
        "EventOutcome",
        "AuthProvider",
        "GuestClaimState",
    ];

    /// <summary>
    /// The declared type names that reflection could not resolve to exactly one public enum across the
    /// two assemblies — either absent or ambiguous. Empty when discovery is complete.
    /// </summary>
    public static IReadOnlyList<string> UnresolvedTypeNames { get; }

    /// <summary>The discovered wire enum types, in the declared order.</summary>
    public static IReadOnlyList<Type> All { get; }

    /// <summary>Every member of every discovered wire enum, as reflection reports them.</summary>
    public static IReadOnlyList<WireEnumMember> AllMembers { get; }

    static WireEnums()
    {
        // Anchor on a non-enum type per assembly, so the assemblies are located without presupposing
        // any of the enums this class is responsible for discovering.
        Type[] publicEnums =
        [
            .. new[] { typeof(BaseEntity).Assembly, typeof(GetSquadHandler).Assembly }
                .SelectMany(assembly => assembly.GetExportedTypes())
                .Where(type => type.IsEnum),
        ];

        var byName = publicEnums.ToLookup(type => type.Name, StringComparer.Ordinal);

        var resolved = new List<Type>(DeclaredTypeNames.Length);
        var unresolved = new List<string>();

        foreach (string name in DeclaredTypeNames)
        {
            Type[] matches = [.. byName[name]];

            if (matches.Length == 1)
            {
                resolved.Add(matches[0]);
            }
            else
            {
                unresolved.Add(name);
            }
        }

        All = resolved;
        UnresolvedTypeNames = unresolved;
        AllMembers = [.. resolved.SelectMany(Members)];
    }

    /// <summary>
    /// The members of <paramref name="enumType"/> as reflection reports them, each paired with its
    /// exact C# member name and its boxed value.
    /// </summary>
    /// <param name="enumType">The enum type to enumerate.</param>
    /// <returns>One entry per declared member name.</returns>
    public static IReadOnlyList<WireEnumMember> Members(Type enumType)
    {
        ArgumentNullException.ThrowIfNull(enumType);

        return
        [
            .. Enum.GetNames(enumType)
                .Select(name => new WireEnumMember(enumType, name, Enum.Parse(enumType, name))),
        ];
    }
}

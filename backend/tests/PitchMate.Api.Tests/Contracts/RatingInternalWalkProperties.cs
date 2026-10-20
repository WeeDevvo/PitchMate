using System.Reflection;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Rating;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// The guards for <b>Property 15 — No rating internal is reachable from any new read's contract</b> and
/// <b>Property 16 — The rating-name matcher flags whole words and nothing else</b> (match-read-models
/// tasks 14.1–14.2).
/// <para>
/// The walk starts from <see cref="MatchList"/>, <see cref="MatchDetail"/> and
/// <see cref="WorkingTeamsView"/> and follows every public member's declared type, collection and array
/// element, nullable underlying type and generic argument, with cycle detection and no depth bound. It
/// fails on a member whose type is a rating internal — anything in <c>PitchMate.Domain.Rating</c>, or any
/// type whose name contains <c>Rating</c> (μ/σ, snapshots, rating state, the display rating and its
/// parameters) — and on a member whose name the matcher flags.
/// </para>
/// <para>
/// The second conjunct: no type outside the working-teams read itself declares, returns, accepts or holds
/// a <see cref="SplitPrediction"/> — in particular nothing that updates ratings or balances teams — so the
/// disclosed probabilities stay presentational. This restricts what the three reads carry; it asserts no
/// confidentiality of the display rating, which the squad leaderboard still publishes.
/// </para>
/// <para><b>Validates: Requirements 6.1, 6.2, 6.4, 6.5, 6.7, 6.8.</b></para>
/// </summary>
public sealed class RatingInternalWalkProperties
{
    private static readonly Type[] Contracts = [typeof(MatchList), typeof(MatchDetail), typeof(WorkingTeamsView)];

    // ---- Property 15 ----------------------------------------------------------------------------

    [Fact]
    public void NoRatingInternalIsReachableFromTheThreeContracts()
    {
        IReadOnlyList<string> offences = [.. Contracts.SelectMany(static contract => Walk(contract).Offences)];

        Assert.True(offences.Count == 0, string.Join(Environment.NewLine, offences));
    }

    [Fact]
    public void TheWalkReachesAllThreeContractsAndANestedMemberOfEach()
    {
        foreach (Type contract in Contracts)
        {
            WalkResult walk = Walk(contract);

            Assert.Contains(contract, walk.Visited);
            Assert.True(
                walk.NestedMemberCount >= 1,
                $"The walk from {contract.Name} inspected no member of a nested type.");
        }
    }

    // Feature: match-read-models, Property 15: No rating internal is reachable from any new read's
    // contract — the walk classifies planted and clean contract shapes.
    [Property(MaxTest = 100)]
    public Property TheWalkDetectsPlantedRatingInternalsAndPassesNearMisses() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(PlantedShapes)),
            shape =>
            {
                IReadOnlyList<string> offences = Walk(shape.Type).Offences;
                return (shape.Planted == (offences.Count > 0))
                    .ToProperty()
                    .Label($"{shape.Type.Name}: {string.Join("; ", offences)}")
                    .Collect(shape.Planted ? "planted" : "clean");
            });

    [Fact]
    public void NoRatingUpdateOrBalancingTypeHoldsASplitPrediction()
    {
        Type[] permitted = [typeof(SplitPrediction), typeof(WorkingTeamsView), typeof(GetWorkingTeamsHandler)];

        List<string> holders =
        [
            .. new[] { typeof(Rating).Assembly, typeof(GetWorkingTeamsHandler).Assembly, typeof(PitchMate.Infrastructure.PlackettLuceRatingEngine).Assembly }
                .SelectMany(static assembly => assembly.GetTypes())
                .Where(type => !permitted.Any(allowed => type == allowed || type.DeclaringType == allowed))
                .Where(static type => SignatureTypes(type).Any(static signature => Mentions(signature, typeof(SplitPrediction))))
                .Select(static type => type.FullName!),
        ];

        Assert.True(holders.Count == 0, $"Types holding a SplitPrediction: {string.Join(", ", holders)}");
        Assert.Contains(SignatureTypes(typeof(WorkingTeamsView)), static type => Mentions(type, typeof(SplitPrediction)));
    }

    // ---- Property 16 ----------------------------------------------------------------------------

    [Theory]
    [InlineData("mu", true)]
    [InlineData("Mu", true)]
    [InlineData("teamSigma", true)]
    [InlineData("uncertainty_value", true)]
    [InlineData("RatingK", true)]
    [InlineData("C", true)]
    [InlineData("participantCount", false)]
    [InlineData("candidateDays", false)]
    [InlineData("bibFlag", false)]
    [InlineData("kickoffLineup", false)]
    [InlineData("rosterPosition", false)]
    [InlineData("location", false)]
    [InlineData("musicVenue", false)]
    [InlineData("location_k_k", true)]
    [InlineData("kickoffK", true)]
    public void TheMatcherFlagsPinnedNames(string name, bool flagged) =>
        Assert.Equal(flagged, RatingNameMatcher.IsFlagged(name));

    // Feature: match-read-models, Property 16: The rating-name matcher flags whole words and nothing else.
    [Property(MaxTest = 200)]
    public Property TheMatcherFlagsWholeWordsAndNothingElse() =>
        Prop.ForAll(
            Arb.From(
                from words in Gen.ListOf(Gen.Elements(SafeWords.Concat(RatingNameMatcher.FlaggedWords).ToArray())).Where(static list => list.Count is > 0 and < 5)
                from style in Gen.Elements("camel", "pascal", "snake")
                // Two single-letter words written together in camel or Pascal case form an acronym run
                // ("locationKK") that no splitting rule can decode, so only snake case may place them
                // side by side.
                where style == "snake" || !words.Zip(words.Skip(1)).Any(static pair => pair.First.Length == 1 && pair.Second.Length == 1)
                select (Words: words.ToArray(), Style: style)),
            sample =>
            {
                string name = Join(sample.Words, sample.Style);
                bool expected = sample.Words.Any(RatingNameMatcher.FlaggedWords.Contains);

                return (RatingNameMatcher.IsFlagged(name) == expected)
                    .ToProperty()
                    .Label($"{name} expected {expected}")
                    .Collect(expected ? "flagged" : "clean");
            });

    // ---- The walk -------------------------------------------------------------------------------

    /// <summary>Words that are not rating internals, several containing c, k, mu or sigma letters inside them.</summary>
    private static readonly string[] SafeWords =
        ["count", "kickoff", "back", "music", "team", "candidate", "days", "location", "bib", "flag", "roster", "position", "clock", "keeper"];

    private static readonly PlantedShape[] PlantedShapes =
    [
        new(typeof(PlantedRatingMember), true),
        new(typeof(PlantedNullableRating), true),
        new(typeof(PlantedRatingList), true),
        new(typeof(PlantedNestedRating), true),
        new(typeof(PlantedSigmaName), true),
        new(typeof(PlantedSnapshot), true),
        new(typeof(NearMissNames), false),
        new(typeof(CleanNested), false),
    ];

    private static WalkResult Walk(Type root)
    {
        var visited = new HashSet<Type>();
        var offences = new List<string>();
        int nested = 0;
        var pending = new Stack<Type>([root]);

        while (pending.TryPop(out Type? type))
        {
            if (!visited.Add(type) || !IsWalked(type))
            {
                continue;
            }

            foreach (PropertyInfo property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (type != root)
                {
                    nested++;
                }

                if (RatingNameMatcher.IsFlagged(property.Name))
                {
                    offences.Add($"{type.Name}.{property.Name} is named like a rating internal");
                }

                foreach (Type reached in Constituents(property.PropertyType))
                {
                    if (IsRatingInternal(reached))
                    {
                        offences.Add($"{type.Name}.{property.Name} exposes {reached.Name}");
                    }
                    else
                    {
                        pending.Push(reached);
                    }
                }
            }
        }

        return new WalkResult(visited, offences, nested);
    }

    /// <summary>A type and, recursively, its array element, nullable underlying type and generic arguments.</summary>
    private static IEnumerable<Type> Constituents(Type type)
    {
        yield return type;

        Type? inner = type.IsArray ? type.GetElementType() : Nullable.GetUnderlyingType(type);
        IEnumerable<Type> children = inner is not null
            ? [inner]
            : type.IsGenericType ? type.GetGenericArguments() : [];

        foreach (Type child in children.SelectMany(Constituents))
        {
            yield return child;
        }
    }

    private static bool IsWalked(Type type) =>
        !type.IsPrimitive && !type.IsEnum && type != typeof(string)
        && (type.Namespace?.StartsWith("PitchMate.", StringComparison.Ordinal) == true);

    private static bool IsRatingInternal(Type type) =>
        type.Namespace == typeof(Rating).Namespace
        || type.Name.Contains("Rating", StringComparison.Ordinal)
        || type.Name.Contains("Snapshot", StringComparison.Ordinal);

    /// <summary>Every type in a type's member signatures: fields, properties, method parameters and returns, constructor parameters.</summary>
    private static IEnumerable<Type> SignatureTypes(Type type)
    {
        const BindingFlags all = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;

        return type.GetFields(all).Select(static field => field.FieldType)
            .Concat(type.GetProperties(all).Select(static property => property.PropertyType))
            .Concat(type.GetMethods(all).SelectMany(static method => method.GetParameters().Select(static p => p.ParameterType).Append(method.ReturnType)))
            .Concat(type.GetConstructors(all).SelectMany(static ctor => ctor.GetParameters().Select(static p => p.ParameterType)));
    }

    private static bool Mentions(Type signature, Type target) =>
        Constituents(signature).Contains(target);

    private static string Join(string[] words, string style) => style switch
    {
        "snake" => string.Join("_", words),
        "pascal" => string.Concat(words.Select(Capitalise)),
        _ => words[0] + string.Concat(words.Skip(1).Select(Capitalise)),
    };

    private static string Capitalise(string word) => char.ToUpperInvariant(word[0]) + word[1..];

    private sealed record WalkResult(IReadOnlySet<Type> Visited, IReadOnlyList<string> Offences, int NestedMemberCount);

    /// <summary>A test-only contract shape and whether the walk must flag it.</summary>
    public sealed record PlantedShape(Type Type, bool Planted)
    {
        public override string ToString() => Type.Name;
    }

    private sealed record PlantedRatingMember(Rating Skill);

    private sealed record PlantedNullableRating(Rating? Skill);

    private sealed record PlantedRatingList(IReadOnlyList<Rating> Skills);

    private sealed record PlantedNestedRating(PlantedRatingMember Inner);

    private sealed record PlantedSigmaName(double TeamSigma);

    private sealed record PlantedSnapshot(PitchMate.Domain.Matches.RatingSnapshot Snapshot);

    private sealed record NearMissNames(int BackCount, string Kickoff, bool MusicFlag, double Clock);

    private sealed record CleanNested(NearMissNames Inner, IReadOnlyList<NearMissNames> Many);
}

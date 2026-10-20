using System.Reflection;
using System.Text.Json;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using PitchMate.Api.Tests.Auth;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;
using HttpJsonOptions = Microsoft.AspNetCore.Http.Json.JsonOptions;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// The guard for <b>Property 5 — Every entry and every detail declares the same members whatever the
/// state</b> (match-read-models task 7.6).
/// <para>
/// <b>Validates: Requirements 1.8, 2.6</b>
/// </para>
/// <para>
/// A client reading a match should never have to ask which members a state carries: the serialised
/// body's <b>set of member names is identical across all six lifecycle states</b>, an absent single
/// value is an explicit <c>null</c>-valued member rather than being omitted or replaced by a
/// placeholder, and an absent collection is an empty collection.
/// </para>
/// <para>
/// <b>The contracts are discovered, not named.</b> The property ranges over
/// <see cref="MatchReadContracts.StateDependentContracts"/> — every contract reachable from the chore's
/// reads that declares a <see cref="MatchState"/> member. That is <see cref="MatchListEntry"/> today and
/// picks up <c>MatchDetail</c> when task 10.1 lands, which is why Requirement 2.6 is claimed here
/// without the property being claimed twice. Instances are built generically from each contract's
/// constructor, with every optional member independently present or absent.
/// </para>
/// </summary>
public sealed class MatchStateIndependentMembersProperties : IClassFixture<AuthApiFactory>
{
    private static readonly NullabilityInfoContext Nullability = new();

    private readonly JsonSerializerOptions _options;

    /// <summary>Reads the JSON options the mapped endpoints serialise through.</summary>
    /// <param name="factory">The shared in-memory Api host factory.</param>
    public MatchStateIndependentMembersProperties(AuthApiFactory factory)
    {
        ArgumentNullException.ThrowIfNull(factory);

        _options = factory.Services.GetRequiredService<IOptions<HttpJsonOptions>>().Value.SerializerOptions;
    }

    // Feature: match-read-models, Property 5: Every entry and every detail declares the same members
    // whatever the state.
    /// <summary>
    /// **Validates: Requirements 1.8, 2.6** — for any discovered state-dependent contract, any state and
    /// any choice of present and absent members, the serialised body carries exactly the contract's
    /// declared members, with each absent single value an explicit <c>null</c> and each absent
    /// collection <c>[]</c>.
    /// </summary>
    [Property(MaxTest = 100)]
    public Property EveryStateSerialisesTheSameMembers() =>
        Prop.ForAll(
            Arb.From(
                from contract in Gen.Elements(MatchReadContracts.StateDependentContracts.ToArray())
                from state in Gen.Elements(Enum.GetValues<MatchState>())
                from seed in Gen.Choose(0, int.MaxValue)
                select (Contract: contract, State: state, Seed: seed)),
            testCase =>
            {
                var random = new System.Random(testCase.Seed);
                var absent = new List<string>();

                object instance = Build(testCase.Contract, testCase.State, random, absent, topLevel: true);
                using JsonDocument body = JsonDocument.Parse(JsonSerializer.Serialize(instance, testCase.Contract, _options));

                IReadOnlyList<string> offences = Offences(testCase.Contract, body.RootElement, absent);

                return (offences.Count == 0)
                    .ToProperty()
                    .Label($"{testCase.Contract.Name} in {testCase.State}: {string.Join("; ", offences)}")
                    .Collect($"{testCase.Contract.Name}/{testCase.State}");
            });

    /// <summary>
    /// The non-vacuity floor: discovery found the list entry, and it really does carry members that a
    /// state can leave absent — a nullable single value and a collection — so the property's null and
    /// empty-collection clauses have something to bite on.
    /// </summary>
    [Fact]
    public void TheDiscoveredContractSetIsNonVacuous()
    {
        Assert.Contains(typeof(MatchListEntry), MatchReadContracts.StateDependentContracts);

        ParameterInfo[] parameters = PrimaryConstructor(typeof(MatchListEntry)).GetParameters();
        Assert.Contains(parameters, static parameter => IsOptionalSingle(parameter));
        Assert.Contains(parameters, static parameter => IsCollection(parameter.ParameterType));
    }

    /// <summary>
    /// The planted-violation control: a body that omits an absent member, or substitutes a placeholder
    /// for an absent collection, is reported.
    /// </summary>
    [Fact]
    public void TheRuleFailsOnAnOmittedOrPlaceholderMember()
    {
        using JsonDocument omitted = JsonDocument.Parse("""{ "matchId": "x" }""");
        Assert.NotEmpty(Offences(typeof(MatchListEntry), omitted.RootElement, []));

        object entry = Build(typeof(MatchListEntry), MatchState.Confirmed, new System.Random(1), [], topLevel: true);
        string json = JsonSerializer.Serialize(entry, _options).Replace("\"candidateDays\":[]", "\"candidateDays\":null", StringComparison.Ordinal);
        using JsonDocument placeholder = JsonDocument.Parse(json);
        Assert.NotEmpty(Offences(typeof(MatchListEntry), placeholder.RootElement, ["CandidateDays"]));
    }

    /// <summary>
    /// One offence per declared member that is missing or undeclared, and per absent member whose wire
    /// form is not an explicit <c>null</c> or <c>[]</c>.
    /// </summary>
    private static IReadOnlyList<string> Offences(Type contract, JsonElement body, IReadOnlyCollection<string> absent)
    {
        var offences = new List<string>();
        ParameterInfo[] parameters = PrimaryConstructor(contract).GetParameters();

        HashSet<string> declared = [.. parameters.Select(static parameter => WireName(parameter.Name!))];
        HashSet<string> emitted = [.. body.EnumerateObject().Select(static member => member.Name)];

        offences.AddRange(declared.Except(emitted).Select(static name => $"member '{name}' is omitted"));
        offences.AddRange(emitted.Except(declared).Select(static name => $"member '{name}' is not declared"));

        foreach (ParameterInfo parameter in parameters.Where(parameter => absent.Contains(parameter.Name!)))
        {
            if (!body.TryGetProperty(WireName(parameter.Name!), out JsonElement value))
            {
                continue;
            }

            if (IsCollection(parameter.ParameterType))
            {
                if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() != 0)
                {
                    offences.Add($"absent collection '{parameter.Name}' is {value.GetRawText()}, not []");
                }
            }
            else if (value.ValueKind != JsonValueKind.Null)
            {
                offences.Add($"absent value '{parameter.Name}' is {value.GetRawText()}, not null");
            }
        }

        return offences;
    }

    /// <summary>
    /// Builds an instance of a contract record from its primary constructor. The <see cref="MatchState"/>
    /// member takes <paramref name="state"/>; each nullable value and each collection is independently
    /// present or absent (absences of the top-level contract are recorded); every other member takes a
    /// sample value.
    /// </summary>
    private static object Build(Type type, MatchState state, System.Random random, List<string> absent, bool topLevel)
    {
        ParameterInfo[] parameters = PrimaryConstructor(type).GetParameters();
        object?[] arguments = new object?[parameters.Length];

        for (int i = 0; i < parameters.Length; i++)
        {
            ParameterInfo parameter = parameters[i];
            Type parameterType = parameter.ParameterType;
            bool makeAbsent = (IsOptionalSingle(parameter) || IsCollection(parameterType)) && random.Next(2) == 0;

            if (makeAbsent && topLevel)
            {
                absent.Add(parameter.Name!);
            }

            arguments[i] = parameterType == typeof(MatchState)
                ? state
                : IsCollection(parameterType)
                    ? Collection(MatchReadContracts.ElementOrSelf(parameterType), makeAbsent ? 0 : 1, state, random)
                    : makeAbsent
                        ? null
                        : Sample(Nullable.GetUnderlyingType(parameterType) ?? parameterType, state, random);
        }

        return PrimaryConstructor(type).Invoke(arguments);
    }

    private static Array Collection(Type element, int length, MatchState state, System.Random random)
    {
        Array array = Array.CreateInstance(element, length);
        for (int i = 0; i < length; i++)
        {
            array.SetValue(Sample(element, state, random), i);
        }

        return array;
    }

    private static object Sample(Type type, MatchState state, System.Random random) =>
        type == typeof(string) ? "sample"
        : type == typeof(Guid) ? Guid.NewGuid()
        : type == typeof(int) ? random.Next(0, 20)
        : type == typeof(bool) ? random.Next(2) == 0
        : type == typeof(DateTimeOffset) ? DateTimeOffset.UnixEpoch.AddDays(random.Next(20_000))
        : type == typeof(MatchState) ? state
        : type.IsEnum ? Enum.GetValues(type).GetValue(0)!
        : Build(type, state, random, [], topLevel: false);

    private static ConstructorInfo PrimaryConstructor(Type type) =>
        type.GetConstructors().OrderByDescending(static ctor => ctor.GetParameters().Length).First();

    /// <summary>A nullable single value: a <see cref="Nullable{T}"/> or a nullable reference that is not a collection.</summary>
    private static bool IsOptionalSingle(ParameterInfo parameter) =>
        !IsCollection(parameter.ParameterType)
        && (Nullable.GetUnderlyingType(parameter.ParameterType) is not null
            || !parameter.ParameterType.IsValueType
                && Nullability.Create(parameter).WriteState == NullabilityState.Nullable);

    private static bool IsCollection(Type type) =>
        type != typeof(string) && MatchReadContracts.ElementOrSelf(type) != (Nullable.GetUnderlyingType(type) ?? type);

    private static string WireName(string name) => JsonNamingPolicy.CamelCase.ConvertName(name);
}

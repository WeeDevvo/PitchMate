using System.Text.Json;
using System.Text.Json.Serialization;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using PitchMate.Api.Tests.Auth;
using HttpJsonOptions = Microsoft.AspNetCore.Http.Json.JsonOptions;

namespace PitchMate.Api.Tests.Serialisation;

/// <summary>
/// The Enum_Vocabulary_Guard for <b>Property 6 — Enum names round-trip through the wire contract</b>.
/// <para>
/// <b>Validates: Requirements 4.1, 4.2, 4.7, 4.9</b>
/// </para>
/// <para>
/// The options under test are the <i>configured</i> ones, resolved as
/// <c>IOptions&lt;Microsoft.AspNetCore.Http.Json.JsonOptions&gt;</c> from a booted
/// <c>WebApplicationFactory&lt;Program&gt;</c> host — not a hand-built instance. That distinction is the
/// point of the guard: it fails if <c>AddWireJsonContract()</c> is ever dropped from <c>Program.cs</c>
/// or registered where the minimal-API surface does not see it, which a locally-constructed options
/// object could never detect (Requirement 4.5).
/// </para>
/// <para>
/// Members are drawn by reflection over each enum type, so a member added later is covered without
/// this file being edited (Requirement 4.9), and the non-vacuity fact below pins both the member count
/// per type and the discovered type count so a shrunken or empty set fails rather than passes.
/// </para>
/// </summary>
public sealed class WireEnumVocabularyProperties : IClassFixture<AuthApiFactory>
{
    private readonly JsonSerializerOptions _options;

    public WireEnumVocabularyProperties(AuthApiFactory factory)
    {
        ArgumentNullException.ThrowIfNull(factory);

        // Accessing Services boots the host, so these are the options the mapped endpoints serialise
        // through and the options the OpenAPI document exporter derives its enum schemas from.
        _options = factory.Services
            .GetRequiredService<IOptions<HttpJsonOptions>>()
            .Value
            .SerializerOptions;
    }

    /// <summary>Every (wire enum, member) pair reflection reports, for the exhaustive theory below.</summary>
    public static TheoryData<Type, string> AllWireEnumMembers()
    {
        var data = new TheoryData<Type, string>();

        foreach (WireEnumMember member in WireEnums.AllMembers)
        {
            data.Add(member.EnumType, member.Name);
        }

        return data;
    }

    // Feature: api-response-contracts, Property 6: Enum names round-trip through the wire contract.
    // Validates: Requirements 4.1, 4.2, 4.7, 4.9
    [Property(MaxTest = 300, Arbitrary = new[] { typeof(WireEnumMemberGenerators) })]
    public Property Property6_EnumNamesRoundTripThroughTheWireContract(WireEnumMember member)
    {
        ArgumentNullException.ThrowIfNull(member);

        string json = JsonSerializer.Serialize(member.Value, member.EnumType, _options);
        object? parsed = JsonSerializer.Deserialize(json, member.EnumType, _options);

        // The wire name is the C# member name verbatim — no naming policy, no numeric form.
        bool serialisesToItsExactName = string.Equals(json, $"\"{member.Name}\"", StringComparison.Ordinal);

        // And that same name reads back as the very member it came from.
        bool deserialisesBackToTheSameMember = Equals(parsed, member.Value);

        return (serialisesToItsExactName && deserialisesBackToTheSameMember)
            .ToProperty()
            .Label($"{member} serialised as {json}, read back as {parsed}")
            .Collect(member.EnumType.Name);
    }

    // Exhaustive companion to the property: every member of every wire enum, named individually so a
    // failure identifies the exact member rather than a shrunk counterexample.
    [Theory]
    [MemberData(nameof(AllWireEnumMembers))]
    public void EveryWireEnumMemberRoundTripsAsItsName(Type enumType, string memberName)
    {
        object value = Enum.Parse(enumType, memberName);

        string json = JsonSerializer.Serialize(value, enumType, _options);

        Assert.Equal($"\"{memberName}\"", json);
        Assert.Equal(value, JsonSerializer.Deserialize(json, enumType, _options));
    }

    /// <summary>
    /// The non-vacuity floor. Without it the property above could pass over a set that reflection had
    /// quietly stopped finding members — or types — for.
    /// </summary>
    [Fact]
    public void TheDiscoveredWireEnumSetCoversEveryDeclaredTypeAndEveryMember()
    {
        Assert.Empty(WireEnums.UnresolvedTypeNames);

        Assert.True(
            WireEnums.All.Count >= WireEnums.DeclaredTypeCount,
            $"Expected at least {WireEnums.DeclaredTypeCount} wire enum types, discovered {WireEnums.All.Count}: "
                + string.Join(", ", WireEnums.All.Select(type => type.Name)));

        foreach (Type enumType in WireEnums.All)
        {
            Assert.Equal(Enum.GetValues(enumType).Length, WireEnums.Members(enumType).Count);
        }

        Assert.Equal(
            WireEnums.All.Sum(enumType => Enum.GetValues(enumType).Length),
            WireEnums.AllMembers.Count);
    }

    /// <summary>
    /// The registration itself, asserted on the resolved options: the by-name converter is present on
    /// the options the host actually serialises through.
    /// </summary>
    [Fact]
    public void TheConfiguredOptionsCarryTheByNameEnumConverter()
    {
        Assert.Contains(_options.Converters, converter => converter is JsonStringEnumConverter);
    }
}

/// <summary>
/// FsCheck arbitraries for <see cref="WireEnumMember"/>. Members are drawn uniformly from every member
/// of every discovered wire enum, so the generator's input space is exactly what reflection reports and
/// grows on its own when a member is added.
/// </summary>
public static class WireEnumMemberGenerators
{
    /// <summary>Arbitrary for a single wire enum member.</summary>
    public static Arbitrary<WireEnumMember> WireEnumMember() =>
        Arb.From(Gen.Elements(WireEnums.AllMembers.ToArray()));
}

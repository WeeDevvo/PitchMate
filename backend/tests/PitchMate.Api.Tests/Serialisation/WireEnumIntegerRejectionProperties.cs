using System.Globalization;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using PitchMate.Api.Tests.Auth;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Rating;
using PitchMate.Domain.Squads;
using HttpJsonOptions = Microsoft.AspNetCore.Http.Json.JsonOptions;

namespace PitchMate.Api.Tests.Serialisation;

/// <summary>
/// The Enum_Vocabulary_Guard for <b>Property 7 — Integer enum values are rejected in both directions</b>.
/// <para>
/// <b>Validates: Requirements 4.3, 4.8, 13.9</b>
/// </para>
/// <para>
/// Two conjuncts, both asserted against the <i>configured</i> contract rather than a hand-built one:
/// </para>
/// <list type="bullet">
/// <item><b>At the serializer.</b> For every wire enum reflection reports and any integer — including
/// the integers that sit inside that enum's declared range, which are exactly the ones that would bind
/// silently if <c>allowIntegerValues</c> were ever flipped back on — reading that number where the enum
/// is expected fails, in both the plain and the nullable form; and writing any value of that enum never
/// yields a bare JSON number.</item>
/// <item><b>At the endpoint.</b> A request body carrying a numeric enum is answered <c>400</c> through
/// <c>WebApplicationFactory&lt;Program&gt;</c>, on two real endpoints whose bodies carry a wire enum:
/// guest creation (<see cref="SkillTier"/>, in its nullable form) and the feature-flag toggle
/// (<see cref="SquadFeature"/>).</item>
/// </list>
/// <para>
/// The <c>400</c> is pinned to the numeric enum rather than to an earlier rejection from three sides.
/// The request is authenticated with a token the running host accepts, so it is not the uniform
/// unauthenticated <c>401</c>. The rejection carries no <c>code</c> extension, so it is not the squad
/// error seam — which stamps one on every problem it produces — and therefore came from body binding.
/// And the control case posts the very same body with the enum written as its name, which is answered
/// <c>403</c> with the uniform authorisation code: proof that the body bound, the real handler ran, and
/// the only thing the numeric form changed is that the request never got that far.
/// </para>
/// <para>
/// The host is the real Api with one substitution: the membership repository resolves nothing
/// (<see cref="AbsentMembershipRepository"/>), so the control case is answered by the real
/// authorisation gate instead of reaching for a database this in-memory host has no connection to. The
/// numeric cases never consult it — they are rejected before any handler runs.
/// </para>
/// </summary>
public sealed class WireEnumIntegerRejectionProperties : IClassFixture<AuthApiFactory>
{
    /// <summary>A fixed squad identity for the routes. It resolves to no squad, and never needs to.</summary>
    private static readonly Guid SquadId = Guid.Parse("8f2b4d7e-5c1a-4a3b-9e6d-0c7f1b2a3d4e");

    /// <summary>The caller stamped on the forged access token. It backs no membership.</summary>
    private static readonly Guid CallerId = Guid.Parse("1d9c3a5b-7e2f-4c8d-b6a1-5f4e3d2c1b0a");

    private readonly JsonSerializerOptions _options;
    private readonly HttpClient _client;
    private readonly string _bearer;

    /// <summary>
    /// Boots the real Api once for the class, substituting only the membership repository, and resolves
    /// the JSON options from that same host so both conjuncts speak about one registration.
    /// </summary>
    /// <param name="factory">The shared Api host factory, supplying the test configuration and clock.</param>
    public WireEnumIntegerRejectionProperties(AuthApiFactory factory)
    {
        ArgumentNullException.ThrowIfNull(factory);

        WebApplicationFactory<Program> host = factory.WithWebHostBuilder(static builder =>
            builder.ConfigureTestServices(static services =>
            {
                services.RemoveAll<ISquadMembershipRepository>();
                services.AddScoped<ISquadMembershipRepository, AbsentMembershipRepository>();
            }));

        _client = host.CreateClient();

        // The options the mapped endpoints bind and serialise through — not a locally-built instance,
        // so the guard fails if AddWireJsonContract() is ever dropped from Program.cs.
        _options = host.Services.GetRequiredService<IOptions<HttpJsonOptions>>().Value.SerializerOptions;

        _bearer = TestAccessTokens.ValidToken(CallerId);
    }

    /// <summary>The endpoints whose request body carries a wire enum, as raw-JSON body templates.</summary>
    public static IReadOnlyList<EnumBodyEndpoint> EnumBodyEndpoints { get; } =
    [
        new EnumBodyEndpoint(
            "POST /squads/{squadId}/guests",
            HttpMethod.Post,
            $"/squads/{SquadId}/guests",
            typeof(SkillTier),
            "skillTier",
            static token =>
                $"{{\"displayName\":\"Wire Contract Guest\",\"skillTier\":{token},\"lawfulBasisAcknowledged\":true}}"),
        new EnumBodyEndpoint(
            "PUT /squads/{squadId}/features",
            HttpMethod.Put,
            $"/squads/{SquadId}/features",
            typeof(SquadFeature),
            "feature",
            static token => $"{{\"feature\":{token},\"enabled\":true}}"),
    ];

    /// <summary>
    /// Every (endpoint, declared numeric value) pair — the integers a client would most plausibly send
    /// and the ones a permissive converter would bind silently, named individually for the theory below.
    /// </summary>
    public static TheoryData<int, int> DeclaredNumericEnumValues()
    {
        var data = new TheoryData<int, int>();

        for (int index = 0; index < EnumBodyEndpoints.Count; index++)
        {
            foreach (object value in Enum.GetValues(EnumBodyEndpoints[index].EnumType))
            {
                data.Add(index, Convert.ToInt32(value, CultureInfo.InvariantCulture));
            }
        }

        return data;
    }

    // Feature: api-response-contracts, Property 7: Integer enum values are rejected in both directions.
    // Validates: Requirements 4.3, 4.8, 13.9
    [Property(MaxTest = 500, Arbitrary = new[] { typeof(WireEnumIntegerGenerators) })]
    public Property Property7_IntegerEnumValuesAreRejectedAtTheSerializer(WireEnumInteger candidate)
    {
        ArgumentNullException.ThrowIfNull(candidate);

        // Reading the number where the enum is expected fails — in the plain form...
        bool numberRejected = ReadingTheNumberFails(candidate.EnumType, candidate.Value);

        // ...and in the nullable form, which is how an optional enum (SkillTier?) arrives.
        bool nullableNumberRejected =
            ReadingTheNumberFails(typeof(Nullable<>).MakeGenericType(candidate.EnumType), candidate.Value);

        // And nothing of that enum's type is ever written as a bare number: a declared member writes as
        // its quoted name, an undeclared value is refused outright. Neither leaks a numeric form.
        bool neverWrittenAsANumber = WritingNeverYieldsANumber(candidate.EnumType, candidate.Value);

        return (numberRejected && nullableNumberRejected && neverWrittenAsANumber)
            .ToProperty()
            .Label(
                $"{candidate.EnumType.Name} <- {candidate.Value}: read rejected {numberRejected}, "
                    + $"nullable read rejected {nullableNumberRejected}, never written as a number {neverWrittenAsANumber}")
            .Classify(candidate.IsDeclared, "inside the declared range")
            .Classify(!candidate.IsDeclared, "outside the declared range")
            .Collect(candidate.EnumType.Name);
    }

    // Feature: api-response-contracts, Property 7: Integer enum values are rejected in both directions.
    // Validates: Requirements 4.3, 4.8, 13.9
    [Property(MaxTest = 25)]
    public Property Property7_ANumericEnumInARequestBodyIsAnsweredBadRequest(int value)
    {
        string token = value.ToString(CultureInfo.InvariantCulture);
        var failures = new List<string>();

        foreach (EnumBodyEndpoint endpoint in EnumBodyEndpoints)
        {
            EndpointResponseFacts facts = Send(endpoint, token);

            // 400, and from body binding rather than the error seam: the seam stamps a code extension
            // on every problem it produces, so its absence places the rejection before any handler.
            if (facts.Status != StatusCodes.Status400BadRequest || facts.ProblemCode is not null)
            {
                failures.Add($"{endpoint.Description} with {endpoint.MemberName}={token} answered {facts}");
            }
        }

        return (failures.Count == 0)
            .ToProperty()
            .Label(string.Join("; ", failures))
            .Classify(IsDeclaredByAnyBodyEnum(value), "inside a declared range");
    }

    // Exhaustive companion to the property above: every declared numeric value of every enum these two
    // bodies carry. These are the integers a 0-based client would send and the ones that would bind
    // silently if the by-name contract were relaxed, so each is pinned by name rather than sampled.
    [Theory]
    [MemberData(nameof(DeclaredNumericEnumValues))]
    public void ADeclaredNumericEnumValueInARequestBodyIsAnsweredBadRequest(int endpointIndex, int value)
    {
        EnumBodyEndpoint endpoint = EnumBodyEndpoints[endpointIndex];

        EndpointResponseFacts facts = Send(endpoint, value.ToString(CultureInfo.InvariantCulture));

        Assert.Equal(StatusCodes.Status400BadRequest, facts.Status);
        Assert.Null(facts.ProblemCode);
    }

    /// <summary>
    /// The control. The same body with the enum written as its name is not rejected by the binder: it
    /// reaches the real handler, which answers <c>403</c> with the uniform authorisation code because
    /// the caller holds no membership. That attributes the <c>400</c> above to the numeric form alone.
    /// </summary>
    [Fact]
    public void TheSameBodyWithTheEnumAsItsNameBindsAndReachesTheHandler()
    {
        foreach (EnumBodyEndpoint endpoint in EnumBodyEndpoints)
        {
            string memberName = Enum.GetNames(endpoint.EnumType)[0];

            EndpointResponseFacts facts = Send(endpoint, $"\"{memberName}\"");

            Assert.Equal(StatusCodes.Status403Forbidden, facts.Status);
            Assert.Equal(nameof(SquadErrorCode.Unauthorized), facts.ProblemCode);
        }
    }

    /// <summary>
    /// The non-vacuity floor. Without it the properties could pass over an empty candidate set, or over
    /// endpoints whose bodies no longer carry a wire enum at all.
    /// </summary>
    [Fact]
    public void TheNumericRejectionSurfaceIsNonVacuous()
    {
        Assert.NotEmpty(WireEnums.All);
        Assert.NotEmpty(EnumBodyEndpoints);

        foreach (EnumBodyEndpoint endpoint in EnumBodyEndpoints)
        {
            // The enum each body carries is one of the discovered wire enums, not an incidental type.
            Assert.Contains(endpoint.EnumType, WireEnums.All);
            Assert.NotEmpty(WireEnums.Members(endpoint.EnumType));
        }

        // Every wire enum is int-backed, so an arbitrary int is a meaningful candidate for each of them
        // and the generated values are genuinely in the space the converter has to refuse.
        Assert.All(WireEnums.All, enumType => Assert.Equal(typeof(int), Enum.GetUnderlyingType(enumType)));
    }

    private static bool IsDeclaredByAnyBodyEnum(int value) =>
        EnumBodyEndpoints.Any(endpoint => Enum.IsDefined(endpoint.EnumType, value));

    private bool ReadingTheNumberFails(Type targetType, int value)
    {
        try
        {
            JsonSerializer.Deserialize(value.ToString(CultureInfo.InvariantCulture), targetType, _options);
            return false;
        }
        catch (JsonException)
        {
            return true;
        }
    }

    private bool WritingNeverYieldsANumber(Type enumType, int value)
    {
        string written;

        try
        {
            written = JsonSerializer.Serialize(Enum.ToObject(enumType, value), enumType, _options);
        }
        catch (JsonException)
        {
            // Refused outright, which is a rejection rather than a numeric form on the wire.
            return true;
        }

        return written.Length > 1 && written[0] == '"' && written[^1] == '"';
    }

    private EndpointResponseFacts Send(EnumBodyEndpoint endpoint, string enumJsonToken)
    {
        using var request = new HttpRequestMessage(endpoint.Method, endpoint.Route)
        {
            Content = new StringContent(endpoint.Body(enumJsonToken), Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _bearer);

        using HttpResponseMessage response = _client.SendAsync(request).GetAwaiter().GetResult();
        string body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();

        return new EndpointResponseFacts((int)response.StatusCode, ReadProblemCode(body));
    }

    /// <summary>
    /// The <c>code</c> extension of a problem body, or <see langword="null"/> when the body is absent or
    /// carries none — which is how a binding rejection is told apart from an error-seam rejection.
    /// </summary>
    private static string? ReadProblemCode(string body)
    {
        if (string.IsNullOrWhiteSpace(body))
        {
            return null;
        }

        try
        {
            using JsonDocument document = JsonDocument.Parse(body);
            return document.RootElement.ValueKind == JsonValueKind.Object
                && document.RootElement.TryGetProperty("code", out JsonElement code)
                    ? code.GetString()
                    : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

/// <summary>
/// One endpoint whose request body carries a wire enum, described as a raw-JSON template so the enum
/// value can be presented as a number or as a name without the test's own serialiser interfering.
/// </summary>
/// <param name="Description">A readable route description for failure messages.</param>
/// <param name="Method">The HTTP method the route is mapped with.</param>
/// <param name="Route">The concrete request path.</param>
/// <param name="EnumType">The wire enum the body carries.</param>
/// <param name="MemberName">The JSON member carrying that enum, for failure messages.</param>
/// <param name="Body">Builds the request body around a raw JSON token for the enum member.</param>
public sealed record EnumBodyEndpoint(
    string Description,
    HttpMethod Method,
    string Route,
    Type EnumType,
    string MemberName,
    Func<string, string> Body);

/// <summary>The parts of a response this guard reasons about: the status, and the problem code if any.</summary>
/// <param name="Status">The HTTP status code.</param>
/// <param name="ProblemCode">The problem body's <c>code</c> extension, or <see langword="null"/>.</param>
public sealed record EndpointResponseFacts(int Status, string? ProblemCode)
{
    /// <summary>A readable form for failure messages.</summary>
    public override string ToString() => $"{Status} (code: {ProblemCode ?? "none"})";
}

/// <summary>
/// One candidate for the serializer conjunct: an integer presented where a particular wire enum is
/// expected.
/// </summary>
/// <param name="EnumType">The wire enum the integer is presented for.</param>
/// <param name="Value">The integer presented.</param>
public sealed record WireEnumInteger(Type EnumType, int Value)
{
    /// <summary>
    /// Whether the integer falls inside the enum's declared range — the case that would bind silently
    /// rather than fail loudly if integer values were ever accepted again.
    /// </summary>
    public bool IsDeclared => Enum.IsDefined(EnumType, Value);
}

/// <summary>
/// FsCheck arbitraries for <see cref="WireEnumInteger"/>. The enum type is drawn uniformly from every
/// discovered wire enum, so the input space grows on its own as the wire surface does. The integer is
/// drawn with deliberate bias: often one of that enum's own declared numeric values (the silent-bind
/// risk), often a small number around the boundary of the declared range (where an off-by-one would
/// land), and sometimes anywhere in the full <see cref="int"/> range.
/// </summary>
public static class WireEnumIntegerGenerators
{
    /// <summary>Arbitrary for a single integer-presented-for-an-enum candidate.</summary>
    public static Arbitrary<WireEnumInteger> WireEnumInteger() => Arb.From(CandidateGen());

    private static Gen<WireEnumInteger> CandidateGen() =>
        from enumType in Gen.Elements(WireEnums.All.ToArray())
        from value in ValueGen(enumType)
        select new WireEnumInteger(enumType, value);

    private static Gen<int> ValueGen(Type enumType)
    {
        int[] declared = DeclaredValues(enumType);

        return Gen.Frequency(
            (3, Gen.Elements(declared)),
            (3, Gen.Choose(declared.Min() - 4, declared.Max() + 4)),
            (1, Gen.Choose(int.MinValue, int.MaxValue)));
    }

    private static int[] DeclaredValues(Type enumType) =>
    [
        .. Enum.GetValues(enumType)
            .Cast<object>()
            .Select(value => Convert.ToInt32(value, CultureInfo.InvariantCulture)),
    ];
}

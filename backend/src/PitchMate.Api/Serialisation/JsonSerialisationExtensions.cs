using System.Text.Json.Serialization;

namespace PitchMate.Api.Serialisation;

/// <summary>
/// Registers the wire JSON contract for the minimal-API surface (<c>AddWireJsonContract</c>).
/// <para>
/// This is the single place the enum wire vocabulary is decided. Because
/// <c>Microsoft.AspNetCore.OpenApi</c> exports schemas from the very same
/// <see cref="System.Text.Json.JsonSerializerOptions"/> the endpoints serialise through, one
/// registration governs both the serialised response bodies and the enum schemas the document
/// exporter derives — so the emitted OpenAPI document cannot describe a vocabulary the runtime does
/// not speak (Requirements 4.4, 4.5).
/// </para>
/// </summary>
public static class JsonSerialisationExtensions
{
    /// <summary>
    /// Serialises every enum as its C# member name and rejects integer enum values on read, so the
    /// declared OpenAPI vocabulary is the only accepted vocabulary in both directions (design D4).
    /// <para>
    /// No naming policy is applied: the wire name is the C# member name verbatim (<c>"Owner"</c>,
    /// <c>"LiveMatchTracking"</c>, <c>"AlreadyMember"</c>), so the schema's <c>enum</c> array, the
    /// generated TypeScript union, and the C# member names are one vocabulary with no second naming
    /// rule to keep in sync (Requirements 4.1, 4.2).
    /// </para>
    /// <para>
    /// <c>allowIntegerValues: false</c> is deliberate. The converter accepts integers on read by
    /// default, which would let a stale client silently post <c>1</c> for a <c>SkillTier</c> — the
    /// 0-based versus 1-based trap this contract exists to remove, made invisible by a schema that
    /// says <c>string</c>. A numeric enum in a request body is instead rejected at the boundary with
    /// <c>400</c> (Requirement 4.3).
    /// </para>
    /// </summary>
    /// <param name="services">The service collection to add the registration to.</param>
    /// <returns>The same <paramref name="services"/> for chaining.</returns>
    public static IServiceCollection AddWireJsonContract(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.ConfigureHttpJsonOptions(options =>
        {
            options.SerializerOptions.Converters.Add(
                new JsonStringEnumConverter(namingPolicy: null, allowIntegerValues: false));
        });

        return services;
    }
}

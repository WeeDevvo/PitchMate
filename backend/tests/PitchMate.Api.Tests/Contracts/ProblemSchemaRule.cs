using System.Globalization;
using System.Text.Json;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// Reads the declared problem responses out of an emitted OpenAPI document and applies Requirement
/// 2.10's rule to them: every one of them describes the <b>same</b> problem body shape.
/// <para>
/// The rule is stated over the document's JSON rather than over the <c>OpenApiDocument</c> object
/// model, for two reasons. The document is what a client generator consumes, so the JSON is the thing
/// the requirement is actually about; and the object model's shape has moved between
/// <c>Microsoft.OpenApi</c> majors, so navigating it would couple this guard to a library version for
/// no gain.
/// </para>
/// <para>
/// The document is supplied by the caller — <see cref="EmittedDocumentCatalogue"/> reads it off the
/// running host — so the same rule can be applied to a deliberately malformed document in a control.
/// Without that the rule could be satisfied by returning nothing at all.
/// </para>
/// </summary>
public static class ProblemSchemaRule
{
    /// <summary>The lowest status treated as a problem response.</summary>
    public const int MinimumProblemStatus = 400;

    /// <summary>The components prefix a schema reference resolves against.</summary>
    public const string SchemaReferencePrefix = "#/components/schemas/";

    // The operation keys of an OpenAPI path item. A path item also carries non-operation members
    // (`parameters`, `summary`, `$ref`), so the operations cannot simply be "every member".
    private static readonly string[] OperationKeys =
        ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

    /// <summary>
    /// Every declared problem response of the document, one fact per media type — or one fact with no
    /// media type where a problem response declares no content at all, because that is itself an
    /// offence the rule has to be able to report.
    /// </summary>
    /// <param name="document">The emitted document's root element.</param>
    /// <returns>Every declared problem response, in document order.</returns>
    public static IReadOnlyList<ProblemResponseFact> ProblemResponsesOf(JsonElement document)
    {
        var facts = new List<ProblemResponseFact>();

        if (!document.TryGetProperty("paths", out JsonElement paths)
            || paths.ValueKind != JsonValueKind.Object)
        {
            return facts;
        }

        foreach (JsonProperty path in paths.EnumerateObject())
        {
            if (path.Value.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            foreach (JsonProperty operation in path.Value.EnumerateObject())
            {
                if (!OperationKeys.Contains(operation.Name, StringComparer.OrdinalIgnoreCase)
                    || operation.Value.ValueKind != JsonValueKind.Object
                    || !operation.Value.TryGetProperty("responses", out JsonElement responses)
                    || responses.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                string method = operation.Name.ToUpperInvariant();

                foreach (JsonProperty response in responses.EnumerateObject())
                {
                    if (!int.TryParse(
                            response.Name, CultureInfo.InvariantCulture, out int status)
                        || status < MinimumProblemStatus)
                    {
                        continue;
                    }

                    facts.AddRange(FactsFor(path.Name, method, status, response.Value));
                }
            }
        }

        return facts;
    }

    /// <summary>
    /// The identity the rule treats as "the one problem schema": the most frequently declared one,
    /// with the ordinal-least identity breaking a tie so the choice is deterministic across runs.
    /// <para>
    /// Taking the majority rather than a named expectation is deliberate. The rule is "they are all the
    /// same shape", not "they are all <c>ProblemDetails</c>" — naming the type here would restate the
    /// seam's choice instead of measuring the document's consistency, and would have to be edited if
    /// the seam's problem type were ever renamed. That the majority identity <i>is</i> the problem
    /// shape is asserted separately, where it can be reported as its own fact.
    /// </para>
    /// </summary>
    /// <param name="facts">The declared problem responses to inspect.</param>
    /// <returns>The canonical identity, or <see langword="null"/> when none declares a schema.</returns>
    public static string? CanonicalIdentity(IReadOnlyList<ProblemResponseFact> facts)
    {
        ArgumentNullException.ThrowIfNull(facts);

        return facts
            .Select(static fact => fact.SchemaIdentity)
            .OfType<string>()
            .GroupBy(static identity => identity, StringComparer.Ordinal)
            .OrderByDescending(static group => group.Count())
            .ThenBy(static group => group.Key, StringComparer.Ordinal)
            .Select(static group => group.Key)
            .FirstOrDefault();
    }

    /// <summary>
    /// Applies the rule and returns one message per offence, each naming the path, the method and the
    /// status so the offending operation is findable in the source.
    /// </summary>
    /// <param name="facts">The declared problem responses to check.</param>
    /// <returns>Every offence found.</returns>
    public static IReadOnlyList<string> Offences(IReadOnlyList<ProblemResponseFact> facts)
    {
        ArgumentNullException.ThrowIfNull(facts);

        string? canonical = CanonicalIdentity(facts);
        var offences = new List<string>();

        foreach (ProblemResponseFact fact in facts)
        {
            if (fact.SchemaIdentity is null)
            {
                offences.Add(
                    $"{fact.Description} declares no problem body schema, so a client is given "
                        + "nothing to deserialise the failure into.");

                continue;
            }

            if (!string.Equals(fact.SchemaIdentity, canonical, StringComparison.Ordinal))
            {
                offences.Add(
                    $"{fact.Description} describes its problem body as '{fact.SchemaIdentity}' rather "
                        + $"than the one problem schema '{canonical}', so the generated client would "
                        + "carry a second problem type for this operation alone.");
            }
        }

        return offences;
    }

    /// <summary>
    /// Resolves a schema identity to the schema the document defines for it, so a control can check
    /// what the canonical identity actually describes.
    /// </summary>
    /// <param name="document">The emitted document's root element.</param>
    /// <param name="identity">The identity to resolve.</param>
    /// <returns>The resolved schema, or <see langword="null"/> when it is not a resolvable reference.</returns>
    public static JsonElement? Resolve(JsonElement document, string identity)
    {
        ArgumentNullException.ThrowIfNull(identity);

        if (!identity.StartsWith(SchemaReferencePrefix, StringComparison.Ordinal))
        {
            return null;
        }

        string name = identity[SchemaReferencePrefix.Length..];

        return document.TryGetProperty("components", out JsonElement components)
            && components.TryGetProperty("schemas", out JsonElement schemas)
            && schemas.TryGetProperty(name, out JsonElement schema)
                ? schema
                : null;
    }

    private static IEnumerable<ProblemResponseFact> FactsFor(
        string path, string method, int status, JsonElement response)
    {
        if (!response.TryGetProperty("content", out JsonElement content)
            || content.ValueKind != JsonValueKind.Object
            || !content.EnumerateObject().Any())
        {
            yield return new ProblemResponseFact(path, method, status, MediaType: null, SchemaIdentity: null);

            yield break;
        }

        foreach (JsonProperty mediaType in content.EnumerateObject())
        {
            yield return new ProblemResponseFact(
                path, method, status, mediaType.Name, IdentityOf(mediaType.Value));
        }
    }

    private static string? IdentityOf(JsonElement mediaType)
    {
        if (!mediaType.TryGetProperty("schema", out JsonElement schema)
            || schema.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return schema.TryGetProperty("$ref", out JsonElement reference)
            && reference.ValueKind == JsonValueKind.String
                ? reference.GetString()
                : ProblemResponseFact.InlinePrefix + schema.GetRawText();
    }
}

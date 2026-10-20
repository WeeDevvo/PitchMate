using System.Text.Json;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// The route-parameter rule of Requirement 7.5, as a single predicate over one
/// <see cref="RouteParameterFact"/>, plus the projection that reads match operations out of the emitted
/// OpenAPI document so the same predicate can judge them.
/// <para>
/// <b>Validates: Requirements 7.1, 7.2, 7.5, 12.11</b>
/// </para>
/// <para>
/// The rule is one sentence: <i>every parameter a route template names is a parameter the operation
/// declares</i>. It is deliberately one-directional. An operation may declare parameters the template
/// does not name — a query value, a body, a service, the cancellation token — and that is ordinary; the
/// defect this rule exists for is the converse, a URL segment nothing binds. The six squad-scoped match
/// operations were in exactly that state: <c>MapGroup("/squads/{squadId:guid}/matches")</c> supplied the
/// route value, no handler bound it, and the emitted document therefore described six operations whose
/// generated path type omitted a segment the URL could not be built without.
/// </para>
/// <para>
/// The rule lives here, on its own, for the reason <see cref="AuthorizationDeclarationRule"/> does: it
/// is applied to more than one subject. <see cref="DeclaredRouteParameterProperties"/> applies it
/// exhaustively to every endpoint the running host mapped, exhaustively to every match operation of the
/// document the running host emits, and to synthesised endpoints built to break it. A rule restated at
/// each site would be three rules, and the loosest would be the one that stayed green.
/// </para>
/// <para>
/// Every violation is returned rather than the first, and each message names the route, the method and
/// the unbound parameter, because the guard's output is a worklist and an unnamed offender is not
/// findable (Requirement 7.5).
/// </para>
/// </summary>
internal static class RouteParameterRule
{
    /// <summary>
    /// The HTTP methods an OpenAPI path item may key an operation under. Any other member of a path
    /// item — <c>summary</c>, <c>description</c>, <c>parameters</c>, an extension — is not an
    /// operation and is skipped, so the projection reads operations rather than everything.
    /// </summary>
    private static readonly string[] OperationKeys =
        ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

    /// <summary>
    /// Applies the rule to one operation (Requirement 7.5).
    /// </summary>
    /// <param name="operation">The operation to judge.</param>
    /// <returns>
    /// One message per route-template parameter the operation does not declare, each naming the route,
    /// the method and the parameter; empty when every template parameter is declared.
    /// </returns>
    public static IReadOnlyList<string> UnboundRouteParameters(RouteParameterFact operation)
    {
        ArgumentNullException.ThrowIfNull(operation);

        return
        [
            .. operation.RoutePatternParameters
                .Where(parameter => !operation.Declares(parameter))
                .Select(parameter =>
                    $"{operation.Description} names route parameter '{parameter}' but declares no "
                        + $"{operation.Subject} for it."),
        ];
    }

    /// <summary>
    /// Applies the rule across a set of operations, gathering every offender so the message is a
    /// worklist rather than a single first failure.
    /// </summary>
    /// <param name="operations">The operations to judge.</param>
    /// <returns>One message per violation across the whole set.</returns>
    public static IReadOnlyList<string> UnboundRouteParameters(IEnumerable<RouteParameterFact> operations)
    {
        ArgumentNullException.ThrowIfNull(operations);

        return [.. operations.SelectMany(UnboundRouteParameters)];
    }

    /// <summary>
    /// Reads every match operation out of an emitted OpenAPI document, projected so the rule above can
    /// judge it (Requirements 7.1, 7.2, 12.11).
    /// <para>
    /// <b>Which paths are match paths is discovered, not listed.</b> A path belongs to the match surface
    /// when one of its literal segments is <c>matches</c>, which picks up both route groups — the
    /// squad-scoped <c>/squads/{squadId}/matches/...</c> and the per-match <c>/matches/{matchId}/...</c>
    /// — without this projection naming either prefix, so a parameter renamed in the template does not
    /// silently empty the set. The non-vacuity floor in
    /// <see cref="DeclaredRouteParameterProperties"/> is what catches it if the discovery goes wrong
    /// anyway.
    /// </para>
    /// <para>
    /// <b>Declared</b> means <c>in: path</c> and <c>required: true</c>, and nothing else counts. A path
    /// parameter the document declared optional would generate as an optional path value, which is the
    /// same unbuildable URL by another route — Requirement 12.11 asks for a <i>required</i> path value
    /// for every template parameter. Parameters declared on the path item are inherited by each of its
    /// operations, as OpenAPI specifies, so an operation is judged on the union.
    /// </para>
    /// </summary>
    /// <param name="document">The emitted document's root element.</param>
    /// <returns>One projected operation per method of every match path the document declares.</returns>
    public static IReadOnlyList<RouteParameterFact> MatchOperationsOf(JsonElement document)
    {
        if (!document.TryGetProperty("paths", out JsonElement paths))
        {
            return [];
        }

        var operations = new List<RouteParameterFact>();

        foreach (JsonProperty path in paths.EnumerateObject())
        {
            if (!IsMatchPath(path.Name) || path.Value.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            IReadOnlyList<string> templateParameters = TemplateParametersOf(path.Name);
            IReadOnlyList<string> inherited = RequiredPathParametersOf(path.Value);

            foreach (JsonProperty member in path.Value.EnumerateObject())
            {
                if (member.Value.ValueKind != JsonValueKind.Object
                    || !OperationKeys.Contains(member.Name, StringComparer.OrdinalIgnoreCase))
                {
                    continue;
                }

                operations.Add(new RouteParameterFact(
                    path.Name,
                    member.Name.ToUpperInvariant(),
                    RouteParameterFact.RequiredPathParameter,
                    templateParameters,
                    [.. inherited.Concat(RequiredPathParametersOf(member.Value)).Distinct(StringComparer.Ordinal)]));
            }
        }

        return
        [
            .. operations
                .OrderBy(static operation => operation.Route, StringComparer.Ordinal)
                .ThenBy(static operation => operation.Method, StringComparer.Ordinal),
        ];
    }

    /// <summary>
    /// Whether a document path belongs to the match surface — true when one of its literal segments is
    /// <c>matches</c>.
    /// </summary>
    /// <param name="path">The document's path key.</param>
    /// <returns><see langword="true"/> when the path is a match path.</returns>
    public static bool IsMatchPath(string path)
    {
        ArgumentNullException.ThrowIfNull(path);

        return path
            .Split('/', StringSplitOptions.RemoveEmptyEntries)
            .Any(static segment => string.Equals(segment, "matches", StringComparison.Ordinal));
    }

    /// <summary>
    /// Every parameter a document path template names, in template order. Document paths carry no route
    /// constraints — the exporter strips them, so <c>{squadId:guid}</c> is keyed <c>{squadId}</c> — but
    /// a constraint is tolerated here anyway so the parsing describes the template rather than one
    /// exporter's rendering of it.
    /// </summary>
    /// <param name="path">The document's path key.</param>
    /// <returns>The template's parameter names.</returns>
    public static IReadOnlyList<string> TemplateParametersOf(string path)
    {
        ArgumentNullException.ThrowIfNull(path);

        var parameters = new List<string>();
        int index = 0;

        while (index < path.Length)
        {
            int open = path.IndexOf('{', index);

            if (open < 0)
            {
                break;
            }

            int close = path.IndexOf('}', open);

            if (close < 0)
            {
                break;
            }

            string name = path[(open + 1)..close];
            int constraint = name.IndexOf(':', StringComparison.Ordinal);

            parameters.Add(constraint < 0 ? name : name[..constraint]);
            index = close + 1;
        }

        return parameters;
    }

    /// <summary>
    /// The names of every <c>in: path</c>, <c>required: true</c> parameter an operation or path item
    /// declares. A parameter missing either keyword is not counted, which is the point: an optional or
    /// mislocated path parameter is the same unbuildable URL as an absent one.
    /// </summary>
    private static IReadOnlyList<string> RequiredPathParametersOf(JsonElement operationOrPathItem)
    {
        if (!operationOrPathItem.TryGetProperty("parameters", out JsonElement parameters)
            || parameters.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var declared = new List<string>();

        foreach (JsonElement parameter in parameters.EnumerateArray())
        {
            if (parameter.ValueKind != JsonValueKind.Object
                || !parameter.TryGetProperty("name", out JsonElement name)
                || name.ValueKind != JsonValueKind.String)
            {
                continue;
            }

            bool inPath = parameter.TryGetProperty("in", out JsonElement location)
                && location.ValueKind == JsonValueKind.String
                && string.Equals(location.GetString(), "path", StringComparison.Ordinal);

            bool required = parameter.TryGetProperty("required", out JsonElement isRequired)
                && isRequired.ValueKind == JsonValueKind.True;

            if (inPath && required && name.GetString() is { } declaredName)
            {
                declared.Add(declaredName);
            }
        }

        return declared;
    }
}

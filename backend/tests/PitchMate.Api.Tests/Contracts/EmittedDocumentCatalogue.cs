using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Hosting;
using PitchMate.Api.Tests.Auth;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// Boots the real Api once and reads the OpenAPI document it emits.
/// <para>
/// The document comes from the <b>running host</b>, over the route the application itself maps, rather
/// than from the committed <c>packages/api-client/openapi/v1.json</c>. Both matter. The committed file
/// is regenerated exactly once, at the end of this change, and is stale by design until then — a guard
/// reading it would be asserting against the pre-change surface. And the running host is the source
/// the committed file is generated <i>from</i>, so a rule proved here holds of the document the client
/// generator will consume.
/// </para>
/// <para>
/// <c>MapOpenApi()</c> is mapped only in a development host, so the environment is pinned to
/// Development for this fixture through <see cref="WebApplicationFactory{TEntryPoint}.WithWebHostBuilder"/>.
/// The underlying <see cref="AuthApiFactory"/> still supplies the configuration the host validates at
/// startup; this fixture changes nothing but the environment name.
/// </para>
/// </summary>
public sealed class EmittedDocumentCatalogue : IAsyncLifetime
{
    /// <summary>The route the application maps the document at.</summary>
    public const string DocumentRoute = "openapi/v1.json";

    private readonly AuthApiFactory _factory = new();
    private WebApplicationFactory<Program>? _host;
    private JsonDocument? _document;

    /// <summary>The emitted document's root element.</summary>
    public JsonElement Document =>
        (_document ?? throw new InvalidOperationException(
            "The emitted document has not been read yet.")).RootElement;

    /// <summary>Every declared problem response the emitted document carries.</summary>
    public IReadOnlyList<ProblemResponseFact> ProblemResponses { get; private set; } = [];

    /// <summary>Reads the document off the running host.</summary>
    /// <returns>A task that completes once the document is read and parsed.</returns>
    public async Task InitializeAsync()
    {
        _host = _factory.WithWebHostBuilder(static builder =>
            builder.UseEnvironment(Environments.Development));

        using HttpClient client = _host.CreateClient();
        using HttpResponseMessage response =
            await client.GetAsync(new Uri(DocumentRoute, UriKind.Relative));

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"The running host answered {(int)response.StatusCode} for '{DocumentRoute}', so the "
                    + "emitted document could not be read and the rule below would have no subject.");
        }

        _document = JsonDocument.Parse(await response.Content.ReadAsByteArrayAsync());
        ProblemResponses = ProblemSchemaRule.ProblemResponsesOf(_document.RootElement);
    }

    /// <inheritdoc />
    public Task DisposeAsync()
    {
        _document?.Dispose();
        _host?.Dispose();
        _factory.Dispose();

        return Task.CompletedTask;
    }
}

using System.Net;
using System.Net.Http;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using PitchMate.Api.Tests.Auth;

namespace PitchMate.Api.Tests;

/// <summary>
/// Integration tests over the real Api host for <see cref="WebClientCors"/>: a configured web client
/// origin is admitted cross-origin — for a browser preflight and for an actual request, including one
/// the bearer pipeline refuses, so the client can read its <c>401</c> — while any other origin, and every
/// origin on a host with no allow-list, gets no <c>Access-Control-Allow-Origin</c> header.
/// </summary>
public sealed class WebClientCorsTests : IClassFixture<AuthApiFactory>
{
    private const string WebOrigin = "https://web.pitchmate.test";
    private const string OtherOrigin = "https://elsewhere.test";
    private const string AllowOriginHeader = "Access-Control-Allow-Origin";

    private readonly HttpClient _configured;
    private readonly HttpClient _unconfigured;

    /// <summary>Boots one host with <see cref="WebOrigin"/> allowed and one with no allow-list.</summary>
    /// <param name="factory">The shared in-memory Api host factory.</param>
    public WebClientCorsTests(AuthApiFactory factory)
    {
        ArgumentNullException.ThrowIfNull(factory);

        WebApplicationFactory<Program> configured = factory.WithWebHostBuilder(builder =>
            builder.UseSetting($"{WebClientCors.AllowedOriginsKey}:0", WebOrigin));

        _configured = configured.CreateClient();
        _unconfigured = factory.CreateClient();
    }

    [Fact]
    public async Task Preflight_from_the_configured_origin_is_admitted()
    {
        using HttpResponseMessage response = await _configured.SendAsync(Preflight(WebOrigin, "/auth/me", "authorization"));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(WebOrigin, AllowedOrigin(response));
    }

    [Fact]
    public async Task Refused_request_from_the_configured_origin_still_carries_the_cors_header()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/auth/me");
        request.Headers.Add("Origin", WebOrigin);

        using HttpResponseMessage response = await _configured.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(WebOrigin, AllowedOrigin(response));
    }

    [Fact]
    public async Task Preflight_from_another_origin_is_not_admitted()
    {
        using HttpResponseMessage response = await _configured.SendAsync(Preflight(OtherOrigin, "/auth/me", "authorization"));

        Assert.Null(AllowedOrigin(response));
    }

    [Fact]
    public async Task Host_with_no_allow_list_admits_no_origin()
    {
        using HttpResponseMessage response = await _unconfigured.SendAsync(Preflight(WebOrigin, "/health", "content-type"));

        Assert.Null(AllowedOrigin(response));
    }

    private static HttpRequestMessage Preflight(string origin, string path, string requestHeaders)
    {
        var request = new HttpRequestMessage(HttpMethod.Options, path);
        request.Headers.Add("Origin", origin);
        request.Headers.Add("Access-Control-Request-Method", "GET");
        request.Headers.Add("Access-Control-Request-Headers", requestHeaders);
        return request;
    }

    private static string? AllowedOrigin(HttpResponseMessage response) =>
        response.Headers.TryGetValues(AllowOriginHeader, out IEnumerable<string>? values) ? values.Single() : null;
}

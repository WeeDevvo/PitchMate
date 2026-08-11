using System.Reflection;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using PitchMate.Api.LiveTracking;
using PitchMate.Api.LiveTracking.Endpoints;

namespace PitchMate.Api.Tests.Architecture;

/// <summary>
/// The Api-observable half of the live-tracking "no real-time broadcast" structure test (Requirement
/// 13.1, 13.2). Real-time broadcast (live spectating) is out of MVP scope: the tracker records only
/// through client-initiated batched-submission requests and reads are pull-only, so the Api must expose
/// <b>no push / stream / broadcast surface</b> and recording must be reachable through exactly one
/// batched-submission endpoint.
///
/// <para>
/// Complements <c>PitchMate.Infrastructure.Tests.Architecture.LiveTrackingNoBroadcastTests</c>, which
/// proves the inner layers (Domain/Application/Infrastructure) define no hub / websocket / broadcaster
/// type and take no SignalR / websocket / broker dependency. This suite (which can see the
/// <c>PitchMate.Api</c> assembly) proves the part that needs the Api:
/// </para>
/// <list type="bullet">
///   <item><description>Mapping the live-tracking endpoints yields exactly the three documented,
///   pull/POST routes — record an <c>Event_Batch</c>, finalise, and read the running score — and
///   <b>recording is reachable only through the single batched-submission endpoint</b>
///   <c>POST /matches/{matchId:guid}/events</c> (Requirement 13.1, 2.1).</description></item>
///   <item><description>No hub / websocket / SignalR-negotiate route is mapped, and no streaming route
///   exists — a client cannot subscribe for live push (Requirement 13.1).</description></item>
///   <item><description>The <c>PitchMate.Api.LiveTracking</c> namespace defines no SignalR hub /
///   websocket / broadcaster type, and the Api references no SignalR / websocket / Web PubSub package
///   assembly (Requirement 13.1).</description></item>
/// </list>
///
/// The approach mirrors <see cref="NotificationLayeringAndImplementationLocationTests"/>: it is
/// reflection- and routing-only (no database or running host), building a throwaway
/// <see cref="WebApplication"/>, mapping just the live-tracking endpoints onto it, and inspecting the
/// resulting <see cref="RouteEndpoint"/>s.
/// </summary>
public class LiveTrackingNoBroadcastApiTests
{
    private const string ApiName = "PitchMate.Api";
    private const string ApiLiveTrackingNamespace = "PitchMate.Api.LiveTracking";

    // Anchor type creates a hard compile-time and runtime link to the Api assembly, so a build with a
    // renamed/moved endpoint mapper fails to compile rather than passing this suite silently.
    private static readonly Assembly ApiAssembly = typeof(LiveTrackingEndpoints).Assembly;

    /// <summary>The complete, documented set of live-tracking routes — one recording, one finalise, one read.</summary>
    private static readonly (string Method, string Pattern)[] ExpectedRoutes =
    {
        ("POST", "/matches/{matchId:guid}/events"),
        ("POST", "/matches/{matchId:guid}/tracked-result"),
        ("GET", "/matches/{matchId:guid}/running-score"),
    };

    /// <summary>The single batched-submission recording route (Requirement 2.1, 13.1).</summary>
    private const string RecordingMethod = "POST";
    private const string RecordingPattern = "/matches/{matchId:guid}/events";

    /// <summary>Package assemblies delivering push / broadcast machinery — forbidden as Api references (Req 13.1).</summary>
    private static readonly string[] BroadcastPackageAssemblies =
    {
        "Microsoft.AspNetCore.SignalR",
        "Microsoft.AspNetCore.SignalR.Core",
        "Microsoft.AspNetCore.SignalR.Common",
        "Microsoft.Azure.SignalR",
        "Microsoft.AspNetCore.WebSockets",
        "Azure.Messaging.WebPubSub",
        "WebPush",
    };

    /// <summary>Type-name fragments naming a push / stream / broadcast mechanism, scanned within the Api live-tracking namespace (Req 13.1).</summary>
    private static readonly string[] BroadcastTypeNameFragments =
    {
        "Hub",
        "SignalR",
        "WebSocket",
        "Broadcast",
        "Broadcaster",
        "Publisher",
        "PushSender",
        "PushNotifier",
        "ServerSentEvent",
        "LiveFeed",
        "Spectat",
    };

    [Fact]
    public void AnchorTypeResidesInTheApiAssembly()
    {
        // Guard against the anchor drifting into the wrong assembly, which would make the endpoint and
        // type assertions inspect the wrong project and pass misleadingly.
        Assert.Equal(ApiName, ApiAssembly.GetName().Name);
    }

    [Fact]
    public void LiveTrackingEndpoints_AreExactlyTheThreeDocumentedRoutes()
    {
        // Req 13.1 / 2.1 — mapping the live-tracking surface yields exactly the three pull/POST routes and
        // nothing else, so no push / stream / broadcast route can be introduced unnoticed.
        var mapped = MappedLiveTrackingRoutes();

        Assert.NotEmpty(mapped);

        var expected = ExpectedRoutes
            .Select(route => $"{route.Method} {route.Pattern}")
            .OrderBy(text => text, StringComparer.Ordinal)
            .ToArray();

        var actual = mapped
            .Select(route => $"{route.Method} {route.Pattern}")
            .OrderBy(text => text, StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(expected, actual);
    }

    [Fact]
    public void Recording_IsReachableOnlyThroughTheSingleBatchedSubmissionEndpoint()
    {
        // Req 13.1 / 2.1 — recording an Event_Batch is reachable through exactly one endpoint: the
        // batched-submission POST /matches/{matchId:guid}/events. There is no second write path (no
        // per-event route, no push/stream ingest), so all recording flows through the one batched path.
        var recordingRoutes = MappedLiveTrackingRoutes()
            .Where(route => route.Pattern.EndsWith("/events", StringComparison.Ordinal))
            .ToList();

        var single = Assert.Single(recordingRoutes);
        Assert.Equal(RecordingMethod, single.Method);
        Assert.Equal(RecordingPattern, single.Pattern);

        // And it is the only POST that ingests events: the other POST (tracked-result) records no events.
        var eventIngestRoutes = MappedLiveTrackingRoutes()
            .Where(route => route.Pattern.Contains("/events", StringComparison.Ordinal))
            .Select(route => $"{route.Method} {route.Pattern}")
            .ToList();

        Assert.Equal(new[] { $"{RecordingMethod} {RecordingPattern}" }, eventIngestRoutes);
    }

    [Fact]
    public void LiveTrackingEndpoints_MapNoHubWebSocketOrStreamingRoute()
    {
        // Req 13.1 — no route is a SignalR negotiate endpoint, a websocket upgrade, a hub, or any other
        // streaming/push ingress a spectator client could subscribe to.
        string[] forbiddenRouteFragments = { "negotiate", "hub", "ws", "socket", "stream", "broadcast", "subscribe" };

        var offenders = MappedLiveTrackingRoutes()
            .Where(route => forbiddenRouteFragments.Any(fragment =>
                route.Pattern.Contains(fragment, StringComparison.OrdinalIgnoreCase)))
            .Select(route => $"{route.Method} {route.Pattern}")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            "The live-tracking Api must map no hub / websocket / streaming route — recording is " +
            $"batched-POST only and reads are pull-only (Requirement 13.1). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void ApiLiveTrackingNamespace_DefinesNoHubWebSocketOrBroadcasterType()
    {
        // Req 13.1 — the Api live-tracking code defines no SignalR hub, websocket, or broadcaster type;
        // it holds only endpoint mapping, request/response contracts, and the error seam.
        var offenders = LoadableTypes(ApiAssembly)
            .Where(type => type.Namespace?.StartsWith(ApiLiveTrackingNamespace, StringComparison.Ordinal) ?? false)
            .Where(type => HasSignalRHubAncestor(type)
                           || BroadcastTypeNameFragments.Any(fragment =>
                               type.Name.Contains(fragment, StringComparison.OrdinalIgnoreCase)))
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            "The Api live-tracking namespace must define no SignalR hub / websocket / broadcaster type " +
            $"(Requirement 13.1). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Api_ReferencesNoBroadcastPackage()
    {
        // Req 13.1 — the Api references no SignalR / websocket / Web PubSub / web-push package assembly,
        // so broadcast machinery is absent even as an unused reference.
        var referenced = ReferencedAssemblyNames(ApiAssembly);

        var offenders = BroadcastPackageAssemblies
            .Where(referenced.Contains)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            "The Api must reference no SignalR / websocket / Web PubSub / web-push package " +
            $"(Requirement 13.1). Offenders: {Describe(offenders)}.");
    }

    // ---- Helpers --------------------------------------------------------------------------------

    private static IReadOnlyList<(string Method, string Pattern)> MappedLiveTrackingRoutes()
    {
        // Build a throwaway host, map ONLY the live-tracking endpoints, and read back the route endpoints.
        // The real handler registrations (AddLiveTracking) are added so minimal-API parameter inference
        // can classify each endpoint's handler argument as a service; no Infrastructure is wired and the
        // handlers are never resolved or invoked, so this needs no database or running server — only the
        // route metadata is inspected.
        var builder = WebApplication.CreateBuilder();
        builder.Services.AddLiveTracking();
        var app = builder.Build();
        app.MapLiveTrackingEndpoints();

        var routes = new List<(string Method, string Pattern)>();

        foreach (var endpoint in ((IEndpointRouteBuilder)app).DataSources.SelectMany(source => source.Endpoints))
        {
            if (endpoint is not RouteEndpoint routeEndpoint)
            {
                continue;
            }

            var methods = routeEndpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods
                          ?? new[] { "(none)" };
            var pattern = "/" + routeEndpoint.RoutePattern.RawText?.TrimStart('/');

            foreach (var method in methods)
            {
                routes.Add((method, pattern));
            }
        }

        return routes;
    }

    private static bool HasSignalRHubAncestor(Type type)
    {
        for (Type? current = type.BaseType; current is not null; current = current.BaseType)
        {
            if (current.Namespace?.StartsWith("Microsoft.AspNetCore.SignalR", StringComparison.Ordinal) ?? false)
            {
                return true;
            }

            if (current.Name.Equals("Hub", StringComparison.Ordinal)
                || current.Name.StartsWith("Hub`", StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    private static IEnumerable<Type> LoadableTypes(Assembly assembly)
    {
        try
        {
            return assembly.GetTypes();
        }
        catch (ReflectionTypeLoadException ex)
        {
            return ex.Types.Where(type => type is not null).Select(type => type!);
        }
    }

    private static HashSet<string> ReferencedAssemblyNames(Assembly assembly) =>
        assembly.GetReferencedAssemblies()
            .Select(name => name.Name)
            .Where(name => name is not null)
            .ToHashSet(StringComparer.OrdinalIgnoreCase)!;

    private static string Describe(IReadOnlyCollection<string> offenders) =>
        offenders.Count == 0 ? "(none)" : string.Join("; ", offenders);
}

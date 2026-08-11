using System.Reflection;
using NetArchTest.Rules;
using PitchMate.Application.LiveTracking;
using PitchMate.Domain.LiveTracking;
using PitchMate.Infrastructure;

namespace PitchMate.Infrastructure.Tests.Architecture;

/// <summary>
/// The live-tracking "no real-time broadcast" structure test (Requirement 13.1, 13.2). Real-time
/// broadcast (live spectating) is deliberately out of MVP scope: the tracker records only through
/// client-initiated batched-submission requests, and the append-only event log is designed to be
/// sufficient on its own to re-derive the running score and every rich statistic, so a future
/// broadcast capability is a clean later addition that changes none of the recorded data
/// (<c>tech.md</c> → "Live match tracking", decision WT2). This suite proves, on every
/// <c>dotnet test</c> run, that the subsystem introduces <b>no push / stream / broadcast machinery</b>
/// so the boundary cannot silently widen.
///
/// <para>
/// It asserts the parts observable from the inner assemblies (Domain, Application, Infrastructure) —
/// the ones this test project references:
/// </para>
/// <list type="bullet">
///   <item><description>No live-tracking type derives from a SignalR <c>Hub</c> and none is a
///   websocket / push / broadcaster type (by both base-type inspection and a name scan of the
///   live-tracking namespaces).</description></item>
///   <item><description>No live-tracking namespace takes a type-level dependency on SignalR, ASP.NET
///   Core WebSockets, <c>System.Net.WebSockets</c>, Azure Web PubSub, web-push, or a message
///   broker / background-channel — the plumbing a push or broadcast delivery would require.</description></item>
///   <item><description>None of the three inner assemblies references a SignalR / websocket /
///   web-pubsub package assembly, so the machinery is absent even as an unused reference.</description></item>
/// </list>
///
/// <para>
/// The Api-observable half of Requirement 13.1 — that recording is reachable <b>only</b> through the
/// single batched-submission endpoint (and that the Api maps no hub / websocket route and references
/// no SignalR/websocket package) — is asserted by
/// <c>PitchMate.Api.Tests.Architecture.LiveTrackingNoBroadcastApiTests</c>, which can see the
/// <c>PitchMate.Api</c> assembly. Together the two suites cover Requirement 13.1 / 13.2 end to end,
/// mirroring how <see cref="MatchArchitecturePlacementTests"/> /
/// <see cref="NotificationArchitecturePlacementTests"/> split their inner-layer and Api-layer checks.
/// </para>
/// </summary>
public class LiveTrackingNoBroadcastTests
{
    private const string DomainName = "PitchMate.Domain";
    private const string ApplicationName = "PitchMate.Application";
    private const string InfrastructureName = "PitchMate.Infrastructure";

    private const string DomainLiveTrackingNamespace = "PitchMate.Domain.LiveTracking";
    private const string ApplicationLiveTrackingNamespace = "PitchMate.Application.LiveTracking";
    private const string InfrastructureLiveTrackingNamespace = "PitchMate.Infrastructure.LiveTracking";

    // Anchor types create a hard compile-time and runtime link to each asserted assembly, so a build
    // with a renamed/moved subsystem fails to compile rather than passing these assertions silently.
    private static readonly Assembly DomainAssembly = typeof(MatchEvent).Assembly;
    private static readonly Assembly ApplicationAssembly = typeof(IMatchEventRepository).Assembly;
    private static readonly Assembly InfrastructureAssembly = typeof(DependencyInjection).Assembly;

    /// <summary>
    /// Namespaces that would only be needed to <b>push, stream, or broadcast</b> events or the running
    /// score to a client — forbidden anywhere in the live-tracking code, because recording is
    /// batched-POST only and reads are pull-only (Requirement 13.1). Covers SignalR (both the ASP.NET
    /// Core in-process hub stack and Azure SignalR), raw/ASP.NET WebSockets, Azure Web PubSub, web-push,
    /// and the message-broker / background-channel plumbing a fan-out delivery would ride on.
    /// </summary>
    private static readonly string[] BroadcastAndRealtimeNamespaces =
    {
        "Microsoft.AspNetCore.SignalR",
        "Microsoft.Azure.SignalR",
        "Microsoft.AspNetCore.Http.Connections",
        "Microsoft.AspNetCore.WebSockets",
        "System.Net.WebSockets",
        "Azure.Messaging.WebPubSub",
        "Azure.Messaging",
        "WebPush",
        "MassTransit",
        "RabbitMQ",
        "Confluent.Kafka",
        "NServiceBus",
        "System.Threading.Channels",
    };

    /// <summary>
    /// Package assemblies that deliver push / broadcast machinery — forbidden as referenced assemblies
    /// in any inner layer, so the capability is absent even as an unused reference (Requirement 13.1).
    /// </summary>
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

    /// <summary>
    /// Type-name fragments that name a push / stream / broadcast delivery mechanism. Scanned only within
    /// the live-tracking namespaces, so a match is an actual broadcast type in the subsystem rather than
    /// an unrelated type elsewhere (Requirement 13.1).
    /// </summary>
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

    private static readonly (Assembly Assembly, string RootNamespace)[] InnerLiveTrackingNamespaces =
    {
        (DomainAssembly, DomainLiveTrackingNamespace),
        (ApplicationAssembly, ApplicationLiveTrackingNamespace),
        (InfrastructureAssembly, InfrastructureLiveTrackingNamespace),
    };

    [Fact]
    public void AssertedAssembliesAreTheExpectedProjects()
    {
        // Guard against an anchor type drifting into the wrong assembly, which would make the remaining
        // assertions inspect the wrong project and pass misleadingly.
        Assert.Equal(DomainName, DomainAssembly.GetName().Name);
        Assert.Equal(ApplicationName, ApplicationAssembly.GetName().Name);
        Assert.Equal(InfrastructureName, InfrastructureAssembly.GetName().Name);
    }

    [Fact]
    public void LiveTracking_DefinesNoSignalRHubType()
    {
        // Req 13.1 — no live-tracking type derives from a SignalR Hub (the base of a broadcast hub).
        // Checked by walking each type's base chain for a base residing in a SignalR namespace, so the
        // rule holds even though SignalR is not referenced (a Hub base would resolve into its assembly).
        var offenders = InnerLiveTrackingNamespaces
            .SelectMany(pair => LiveTrackingTypes(pair.Assembly, pair.RootNamespace))
            .Where(HasSignalRHubAncestor)
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            "The live-tracking subsystem must define no SignalR hub type: real-time broadcast is out of " +
            $"scope and recording is batched-POST only (Requirement 13.1). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void LiveTracking_DefinesNoWebSocketPushOrBroadcasterType()
    {
        // Req 13.1 — the subsystem introduces no websocket, push-sender, or broadcaster type. Scanning
        // type names within the live-tracking namespaces catches a delivery mechanism by name even if it
        // does not derive from a framework base type.
        var offenders = InnerLiveTrackingNamespaces
            .SelectMany(pair => LiveTrackingTypes(pair.Assembly, pair.RootNamespace))
            .Where(type => BroadcastTypeNameFragments.Any(fragment =>
                type.Name.Contains(fragment, StringComparison.OrdinalIgnoreCase)))
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            "The live-tracking subsystem must define no websocket / push / broadcaster type " +
            $"(Requirement 13.1). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void LiveTrackingNamespaces_HaveNoBroadcastOrRealtimeDependency()
    {
        // Req 13.1 — no live-tracking namespace depends on SignalR, websockets, Web PubSub, web-push, or
        // a message broker / background channel: the plumbing a push or broadcast delivery would need.
        var offenders = new List<string>();

        foreach (var (assembly, rootNamespace) in InnerLiveTrackingNamespaces)
        {
            offenders.AddRange(
                NamespaceDependencyOffenders(assembly, rootNamespace, BroadcastAndRealtimeNamespaces)
                    .Select(typeName => $"{typeName} (in {rootNamespace})"));
        }

        Assert.True(
            offenders.Count == 0,
            "Live-tracking namespaces must not depend on SignalR / websockets / Web PubSub / web-push / " +
            $"a message broker — recording is batched-POST only (Requirement 13.1). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void InnerAssemblies_ReferenceNoBroadcastPackage()
    {
        // Req 13.1 — none of Domain / Application / Infrastructure references a SignalR / websocket /
        // Web PubSub / web-push package assembly, so the machinery is absent even as an unused reference.
        var offenders = new List<string>();

        foreach (var assembly in new[] { DomainAssembly, ApplicationAssembly, InfrastructureAssembly })
        {
            var referenced = ReferencedAssemblyNames(assembly);
            offenders.AddRange(
                BroadcastPackageAssemblies
                    .Where(referenced.Contains)
                    .Select(package => $"{assembly.GetName().Name} references '{package}'"));
        }

        Assert.True(
            offenders.Count == 0,
            "No inner assembly may reference a SignalR / websocket / Web PubSub / web-push package " +
            $"(Requirement 13.1). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void LiveTracking_ExposesNoStreamingOrBroadcastPublicApi()
    {
        // Req 13.1, 13.2 — the recording/query surface returns concrete, pull-derived values (a
        // BatchResult, a RunningScore, a finalise result), never a streaming/observable channel that a
        // caller could subscribe to for live push. Guard the public method return types across the
        // Application use cases and the Domain projection against subscription/stream shapes.
        string[] streamingReturnTypeFragments =
        {
            "IAsyncEnumerable",
            "IObservable",
            "ChannelReader",
            "Subscription",
            "Stream",
        };

        var offenders = new (Assembly Assembly, string RootNamespace)[]
            {
                (ApplicationAssembly, ApplicationLiveTrackingNamespace),
                (DomainAssembly, DomainLiveTrackingNamespace),
            }
            .SelectMany(pair => LiveTrackingTypes(pair.Assembly, pair.RootNamespace))
            .SelectMany(type => type
                .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly)
                .Where(method => streamingReturnTypeFragments.Any(fragment =>
                    UnwrapTaskReturnTypeName(method.ReturnType).Contains(fragment, StringComparison.Ordinal)))
                .Select(method => $"{type.FullName}.{method.Name} returns {method.ReturnType.Name}"))
            .ToList();

        Assert.True(
            offenders.Count == 0,
            "The live-tracking recording/query surface must expose no streaming/observable return type — " +
            $"reads are pull-only over the append-only log (Requirement 13.1, 13.2). Offenders: {Describe(offenders)}.");
    }

    // ---- Helpers --------------------------------------------------------------------------------

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

    private static IReadOnlyList<string> NamespaceDependencyOffenders(
        Assembly assembly, string ownNamespace, params string[] forbiddenNamespaces)
    {
        // If the namespace has no types in this assembly, NetArchTest reports success (nothing to check).
        var result = Types.InAssembly(assembly)
            .That().ResideInNamespaceStartingWith(ownNamespace)
            .Should().NotHaveDependencyOnAny(forbiddenNamespaces)
            .GetResult();

        return result.IsSuccessful
            ? Array.Empty<string>()
            : (result.FailingTypeNames?.ToList() ?? new List<string>());
    }

    private static IEnumerable<Type> LiveTrackingTypes(Assembly assembly, string rootNamespace) =>
        LoadableTypes(assembly)
            .Where(type => type.Namespace?.StartsWith(rootNamespace, StringComparison.Ordinal) ?? false);

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

    private static string UnwrapTaskReturnTypeName(Type returnType)
    {
        // Report the inner type name for Task<T>/ValueTask<T> so a streaming payload is not hidden behind
        // an awaitable wrapper; otherwise report the return type's own name.
        if (returnType.IsGenericType)
        {
            var definitionName = returnType.GetGenericTypeDefinition().Name;
            if (definitionName.StartsWith("Task`", StringComparison.Ordinal)
                || definitionName.StartsWith("ValueTask`", StringComparison.Ordinal))
            {
                return returnType.GetGenericArguments()[0].Name;
            }
        }

        return returnType.Name;
    }

    private static HashSet<string> ReferencedAssemblyNames(Assembly assembly) =>
        assembly.GetReferencedAssemblies()
            .Select(name => name.Name)
            .Where(name => name is not null)
            .ToHashSet(StringComparer.OrdinalIgnoreCase)!;

    private static string Describe(IReadOnlyCollection<string> offenders) =>
        offenders.Count == 0 ? "(none)" : string.Join("; ", offenders);
}

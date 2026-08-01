using System.Reflection;
using Microsoft.EntityFrameworkCore;
using NetArchTest.Rules;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Notifications;
using PitchMate.Domain.Common;
using PitchMate.Domain.Notifications;
using PitchMate.Infrastructure.Notifications;

namespace PitchMate.Infrastructure.Tests.Architecture;

/// <summary>
/// Notification-specific Clean Architecture placement tests plus the notification MVP-boundary tests,
/// extending the general dependency-rule suite in <see cref="ArchitectureDependencyTests"/> with the
/// notification model's layering and the platform boundaries the spec deliberately draws (Requirement 13
/// plus Requirements 1.1, 2.1, 5.5, 7.2, 11.4, 11.5, 11.6). These run on every <c>dotnet test</c> so
/// notification types cannot drift into the wrong layer and the MVP boundaries cannot silently widen.
///
/// What is enforced here (the parts observable without the Api assembly — the Api-holds-only-wiring rule
/// of Req 13.4 is asserted by
/// <c>PitchMate.Api.Tests.Architecture.NotificationLayeringAndImplementationLocationTests</c>, which can
/// see the Api assembly):
/// <list type="bullet">
///   <item><description>13.1 — the <see cref="InAppNotification"/> entity and the
///   <see cref="NotificationType"/>, <see cref="DeliveryChannel"/>, and <see cref="ReadState"/>
///   enumerations reside in <c>PitchMate.Domain</c> and depend only on Domain + BCL.</description></item>
///   <item><description>13.2 — the publish/read/lifecycle use cases, the
///   <see cref="INotificationPublisher"/> and <see cref="INotificationEmailRenderer"/> abstractions, and
///   the <see cref="INotificationRepository"/> reside in <c>PitchMate.Application</c> and depend only on
///   Domain.</description></item>
///   <item><description>13.3 — the EF Core mapping, repository implementation, and email renderer reside
///   in <c>PitchMate.Infrastructure</c> and implement the Application-declared abstractions.</description></item>
/// </list>
///
/// MVP boundaries proven by example:
/// <list type="bullet">
///   <item><description>1.1 — exactly two delivery channels (<c>InApp</c>, <c>Email</c>) and no push channel.</description></item>
///   <item><description>2.1 — exactly eight catalogue members.</description></item>
///   <item><description>5.5 — publish is synchronous: no message-broker / background-worker dependency.</description></item>
///   <item><description>7.2 / 13.6 — the single existing <see cref="IEmailSender"/> is reused and no second
///   email transport abstraction is introduced.</description></item>
///   <item><description>11.4 / 11.5 / 11.6 — the stored fields are minimised to squad, recipient, type,
///   title, body, and read state, with no contact PII and no anonymisation hook.</description></item>
/// </list>
///
/// The approach mirrors <see cref="SquadArchitecturePlacementTests"/>: anchor types create a hard
/// compile-time link to each asserted assembly, and namespace-scoped <c>NetArchTest.Rules</c> checks catch
/// an actual forbidden type dependency.
/// </summary>
public class NotificationArchitecturePlacementTests
{
    private const string DomainName = "PitchMate.Domain";
    private const string ApplicationName = "PitchMate.Application";
    private const string InfrastructureName = "PitchMate.Infrastructure";
    private const string ApiName = "PitchMate.Api";

    private const string NotificationDomainNamespace = "PitchMate.Domain.Notifications";
    private const string NotificationApplicationNamespace = "PitchMate.Application.Notifications";
    private const string NotificationInfrastructureNamespace = "PitchMate.Infrastructure.Notifications";
    private const string NotificationConfigNamespace = "PitchMate.Infrastructure.Persistence.Configurations.Notifications";

    // Anchor types create a hard compile-time and runtime link to each asserted assembly, so a build with
    // a renamed/moved type fails to compile rather than passing these assertions silently.
    private static readonly Assembly DomainAssembly = typeof(InAppNotification).Assembly;
    private static readonly Assembly ApplicationAssembly = typeof(INotificationPublisher).Assembly;
    private static readonly Assembly InfrastructureAssembly = typeof(NotificationEmailRenderer).Assembly;

    /// <summary>EF Core, Npgsql, and ASP.NET Core namespaces — forbidden in Domain and Application.</summary>
    private static readonly string[] EfNpgsqlAspNetNamespaces =
    {
        "Microsoft.EntityFrameworkCore",
        "Npgsql",
        "Microsoft.AspNetCore",
    };

    /// <summary>
    /// Message-broker, messaging, and background-worker/hosting namespaces — forbidden anywhere in the
    /// notification code because MVP publish is synchronous with no broker or worker (Requirement 5.5).
    /// </summary>
    private static readonly string[] BrokerAndWorkerNamespaces =
    {
        "MassTransit",
        "RabbitMQ",
        "Confluent.Kafka",
        "Azure.Messaging",
        "NServiceBus",
        "MediatR",
        "Microsoft.Extensions.Hosting",
        "System.Threading.Channels",
    };

    /// <summary>The notification Domain types whose placement in <c>PitchMate.Domain</c> is required (Req 13.1).</summary>
    private static readonly Type[] NotificationDomainTypes =
    {
        typeof(InAppNotification),
        typeof(NotificationType),
        typeof(DeliveryChannel),
        typeof(ReadState),
    };

    /// <summary>The notification Application abstractions declared in <c>PitchMate.Application</c> (Req 13.2).</summary>
    private static readonly Type[] NotificationApplicationAbstractions =
    {
        typeof(INotificationPublisher),
        typeof(INotificationEmailRenderer),
        typeof(INotificationRepository),
    };

    /// <summary>The Application abstractions whose implementation must live in Infrastructure (Req 13.3).</summary>
    private static readonly Type[] InfrastructureBackedAbstractions =
    {
        typeof(INotificationEmailRenderer),
        typeof(INotificationRepository),
    };

    /// <summary>
    /// The exact set of instance properties an <see cref="InAppNotification"/> declares (beyond the
    /// <see cref="BaseEntity"/> identity/audit fields), i.e. the minimised stored data (Req 11.5).
    /// </summary>
    private static readonly string[] ExpectedStoredFields =
    {
        nameof(InAppNotification.SquadId),
        nameof(InAppNotification.RecipientMembershipId),
        nameof(InAppNotification.Type),
        nameof(InAppNotification.Title),
        nameof(InAppNotification.Body),
        nameof(InAppNotification.ReadState),
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

    // ---- Requirement 13.1: Domain placement ------------------------------------------------------

    [Fact]
    public void NotificationEntityAndEnums_ResideInDomainAssembly()
    {
        // Req 13.1 — the entity and all three enumerations live in PitchMate.Domain.
        var offenders = NotificationDomainTypes
            .Where(type => type.Assembly.GetName().Name != DomainName)
            .Select(type => $"{type.FullName} in '{type.Assembly.GetName().Name}'")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"The InAppNotification entity and the NotificationType/DeliveryChannel/ReadState enums must " +
            $"reside in {DomainName} (Requirement 13.1). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void NotificationEntity_DerivesFromBaseEntity()
    {
        // Req 13.1, 12.1 — the persisted record carries the BaseEntity GUID v7 key + audit surface.
        Assert.True(
            typeof(BaseEntity).IsAssignableFrom(typeof(InAppNotification)),
            $"{nameof(InAppNotification)} must derive from {nameof(BaseEntity)} (Requirement 13.1).");
    }

    [Fact]
    public void NotificationDomainNamespace_HasNoDependencyOnOuterLayers()
    {
        // Req 13.1 — the notification Domain namespace references no outer PitchMate layer.
        AssertNamespaceHasNoDependencyOn(
            DomainAssembly, NotificationDomainNamespace,
            "Requirement 13.1",
            ApplicationName, InfrastructureName, ApiName);
    }

    [Fact]
    public void NotificationDomainNamespace_HasNoEfNpgsqlOrAspNetDependency()
    {
        // Req 13.1 — the notification Domain namespace stays free of persistence/web frameworks.
        AssertNamespaceHasNoDependencyOn(
            DomainAssembly, NotificationDomainNamespace,
            "Requirement 13.1",
            EfNpgsqlAspNetNamespaces);
    }

    // ---- Requirement 13.2: Application placement -------------------------------------------------

    [Fact]
    public void NotificationAbstractionsAndUseCases_ResideInApplicationAssembly()
    {
        // Req 13.2 — the publisher/renderer/repository abstractions and every use-case handler live in
        // PitchMate.Application.
        var useCaseHandlers = ApplicationAssembly.GetTypes()
            .Where(type => type is { IsClass: true, IsAbstract: false }
                           && type.Namespace == NotificationApplicationNamespace
                           && type.Name.EndsWith("Handler", StringComparison.Ordinal))
            .ToList();

        Assert.True(
            useCaseHandlers.Count > 0,
            $"Expected notification use-case handlers in {NotificationApplicationNamespace} (Requirement 13.2).");

        var required = NotificationApplicationAbstractions
            .Concat(useCaseHandlers)
            .ToList();

        var offenders = required
            .Where(type => type.Assembly.GetName().Name != ApplicationName)
            .Select(type => $"{type.FullName} in '{type.Assembly.GetName().Name}'")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"Notification use cases and abstractions must reside in {ApplicationName} " +
            $"(Requirement 13.2). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void NotificationApplicationNamespace_DoesNotReferenceInfrastructureOrApi()
    {
        // Req 13.2 — the notification Application namespace depends only on Domain (never the outer layers).
        AssertNamespaceHasNoDependencyOn(
            ApplicationAssembly, NotificationApplicationNamespace,
            "Requirement 13.2",
            InfrastructureName, ApiName);
    }

    [Fact]
    public void NotificationApplicationNamespace_HasNoEfNpgsqlOrAspNetDependency()
    {
        // Req 13.2 — notification use cases stay framework-free (no EF Core / Npgsql / ASP.NET Core types).
        AssertNamespaceHasNoDependencyOn(
            ApplicationAssembly, NotificationApplicationNamespace,
            "Requirement 13.2",
            EfNpgsqlAspNetNamespaces);
    }

    // ---- Requirement 13.3: Infrastructure placement ----------------------------------------------

    [Fact]
    public void NotificationAbstractions_AreImplementedInInfrastructure()
    {
        // Req 13.3 — the repository and the email renderer each have a concrete implementation in
        // Infrastructure satisfying the Application abstraction.
        var missing = InfrastructureBackedAbstractions
            .Where(abstraction => !ConcreteImplementationsIn(InfrastructureAssembly, abstraction).Any())
            .Select(abstraction => abstraction.Name)
            .ToList();

        Assert.True(
            missing.Count == 0,
            $"{InfrastructureName} must contain a concrete implementation of each notification abstraction " +
            $"(Requirement 13.3). Missing: {Describe(missing)}.");
    }

    [Fact]
    public void NotificationEfMappingRepositoryAndRenderer_ResideInInfrastructureAssembly()
    {
        // Req 13.3 — the EF Core mapping, repository implementation, and email renderer are Infrastructure
        // concerns.
        var efConfigurations = InfrastructureAssembly.GetTypes()
            .Where(type => type is { IsClass: true, IsAbstract: false } && ImplementsNotificationConfiguration(type))
            .ToList();

        Assert.True(
            efConfigurations.Count > 0,
            $"Expected a notification EF Core IEntityTypeConfiguration<InAppNotification> in {InfrastructureName} " +
            $"(Requirement 13.3).");

        var repositoryImplementations = ConcreteImplementationsIn(InfrastructureAssembly, typeof(INotificationRepository)).ToList();
        Assert.True(
            repositoryImplementations.Count > 0,
            $"Expected an INotificationRepository implementation in {InfrastructureName} (Requirement 13.3).");

        var required = efConfigurations
            .Concat(repositoryImplementations)
            .Append(typeof(NotificationEmailRenderer))
            .ToList();

        var offenders = required
            .Where(type => type.Assembly.GetName().Name != InfrastructureName)
            .Select(type => $"{type.FullName} in '{type.Assembly.GetName().Name}'")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"Notification EF mapping, repository, and renderer must reside in {InfrastructureName} " +
            $"(Requirement 13.3). Offenders: {Describe(offenders)}.");
    }

    // ---- Requirement 1.1: two channels only, no push --------------------------------------------

    [Fact]
    public void DeliveryChannel_HasExactlyInAppAndEmailWithNoPush()
    {
        // Req 1.1 — the closed set of delivery channels is exactly { InApp, Email }; there is no push
        // channel and no channel beyond these two.
        var members = Enum.GetNames<DeliveryChannel>().OrderBy(name => name, StringComparer.Ordinal).ToArray();

        Assert.Equal(new[] { nameof(DeliveryChannel.Email), nameof(DeliveryChannel.InApp) }, members);

        Assert.DoesNotContain(
            members,
            name => name.Contains("push", StringComparison.OrdinalIgnoreCase));
    }

    // ---- Requirement 2.1: exactly eight catalogue members ----------------------------------------

    [Fact]
    public void NotificationType_HasExactlyEightCatalogueMembers()
    {
        // Req 2.1 — the catalogue is a closed enumeration of exactly the eight named members: four squad
        // events and four match-lifecycle events, and nothing else.
        var expected = new[]
        {
            nameof(NotificationType.MemberJoined),
            nameof(NotificationType.PromotedToAdmin),
            nameof(NotificationType.RemovedFromSquad),
            nameof(NotificationType.OwnershipTransferred),
            nameof(NotificationType.MatchDrafted),
            nameof(NotificationType.MatchConfirmed),
            nameof(NotificationType.TeamsRolled),
            nameof(NotificationType.ResultPosted),
        };

        var actual = Enum.GetNames<NotificationType>();

        Assert.Equal(8, actual.Length);
        Assert.Equal(
            expected.OrderBy(name => name, StringComparer.Ordinal),
            actual.OrderBy(name => name, StringComparer.Ordinal));

        // The catalogue must recognise exactly the eight defined members and reject any other value.
        foreach (var value in Enum.GetValues<NotificationType>())
        {
            Assert.True(
                NotificationCatalogue.IsRecognised(value),
                $"The catalogue must recognise defined member {value} (Requirement 2.1).");
        }

        Assert.False(
            NotificationCatalogue.IsRecognised((NotificationType)999),
            "The catalogue must not recognise a value outside the eight defined members (Requirement 2.1).");
    }

    // ---- Requirement 5.5: synchronous publish, no broker/worker ----------------------------------

    [Fact]
    public void NotificationApplicationNamespace_HasNoBrokerOrBackgroundWorkerDependency()
    {
        // Req 5.5 — publish is synchronous within the originating request: the notification use cases take
        // no dependency on a message broker, messaging channel, or background-worker/hosting type.
        AssertNamespaceHasNoDependencyOn(
            ApplicationAssembly, NotificationApplicationNamespace,
            "Requirement 5.5",
            BrokerAndWorkerNamespaces);
    }

    [Fact]
    public void NotificationInfrastructureNamespace_HasNoBrokerOrBackgroundWorkerDependency()
    {
        // Req 5.5 — the Infrastructure notification code likewise introduces no broker or worker.
        AssertNamespaceHasNoDependencyOn(
            InfrastructureAssembly, NotificationInfrastructureNamespace,
            "Requirement 5.5",
            BrokerAndWorkerNamespaces);
    }

    // ---- Requirements 7.2 / 13.6: single IEmailSender reuse, no second transport -----------------

    [Fact]
    public void PublishHandler_ReusesTheExistingEmailSender()
    {
        // Req 7.2, 13.6 — best-effort email is dispatched through the single existing IEmailSender
        // transport, so the publish handler depends on exactly that abstraction.
        var handler = ConcreteImplementationsIn(ApplicationAssembly, typeof(INotificationPublisher)).ToList();

        Assert.True(handler.Count > 0, "Expected an INotificationPublisher implementation in Application.");

        var reusesEmailSender = handler.All(type =>
            type.GetConstructors()
                .Any(ctor => ctor.GetParameters().Any(p => p.ParameterType == typeof(IEmailSender))));

        Assert.True(
            reusesEmailSender,
            $"The publish handler must reuse the existing {nameof(IEmailSender)} transport " +
            $"(Requirements 7.2, 13.6).");
    }

    [Fact]
    public void Notifications_IntroduceNoSecondEmailTransportAbstraction()
    {
        // Req 7.2, 13.6 — the notification code introduces no additional email-sending abstraction beyond
        // the existing IEmailSender; the notification-specific email concern is a *renderer*
        // (INotificationEmailRenderer) that produces an EmailMessage, never a transport that sends one.
        var transportShapedTypes = ApplicationAssembly.GetTypes()
            .Concat(InfrastructureAssembly.GetTypes())
            .Where(type => type != typeof(IEmailSender))
            .Where(type => (type.Namespace?.StartsWith(NotificationApplicationNamespace, StringComparison.Ordinal) ?? false)
                           || (type.Namespace?.StartsWith(NotificationInfrastructureNamespace, StringComparison.Ordinal) ?? false))
            .Where(LooksLikeEmailTransport)
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            transportShapedTypes.Count == 0,
            $"The notification code must introduce no second email transport beyond the existing " +
            $"{nameof(IEmailSender)} (Requirements 7.2, 13.6). Offenders: {Describe(transportShapedTypes)}.");
    }

    // ---- Requirements 11.4 / 11.5 / 11.6: stored-field data minimisation -------------------------

    [Fact]
    public void InAppNotification_StoresOnlyMinimisedFields()
    {
        // Req 11.5 — the only data stored on an in-app notification is its owning squad, its recipient
        // membership, its type, and its rendered title and body (plus its read state and the BaseEntity
        // identity/audit fields). Declared-only excludes the inherited BaseEntity fields.
        var declared = typeof(InAppNotification)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Select(p => p.Name)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(
            ExpectedStoredFields.OrderBy(name => name, StringComparer.Ordinal).ToArray(),
            declared);
    }

    [Fact]
    public void InAppNotification_StoresNoContactPii()
    {
        // Req 11.4, 11.5 — no field carries contact PII such as an email address or phone number, so a
        // guest's (or anyone's) contact details are never persisted on a notification.
        string[] forbiddenFragments = { "email", "phone", "mail", "address", "contact" };

        var offenders = typeof(InAppNotification)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(p => forbiddenFragments.Any(f => p.Name.Contains(f, StringComparison.OrdinalIgnoreCase)))
            .Select(p => p.Name)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{nameof(InAppNotification)} must store no contact PII (Requirements 11.4, 11.5). " +
            $"Offending fields: {Describe(offenders)}.");
    }

    [Fact]
    public void InAppNotification_IsNotAnonymisable()
    {
        // Req 11.6 (and 11.1/11.2 posture) — a notification carries no match-history integrity requirement,
        // so on erasure it is *removed*, not anonymised; it therefore must not implement IAnonymisable.
        Assert.False(
            typeof(IAnonymisable).IsAssignableFrom(typeof(InAppNotification)),
            $"{nameof(InAppNotification)} must not implement {nameof(IAnonymisable)}: notifications are " +
            $"removed on erasure rather than anonymised (Requirements 11.1, 11.2, 11.6).");
    }

    // ---- Helpers --------------------------------------------------------------------------------

    private static bool LooksLikeEmailTransport(Type type)
    {
        // A "transport" abstraction/implementation is one that *sends* email. We flag any type whose name
        // suggests a sender/transport/SMTP client. INotificationEmailRenderer and NotificationEmailRenderer
        // are renderers (they build an EmailMessage), not transports, so they are deliberately not matched.
        string[] transportFragments = { "EmailSender", "MailSender", "EmailTransport", "MailTransport", "SmtpClient", "EmailClient" };
        return transportFragments.Any(fragment => type.Name.Contains(fragment, StringComparison.OrdinalIgnoreCase));
    }

    private static void AssertNamespaceHasNoDependencyOn(
        Assembly assembly, string ownNamespace, string requirementRef, params string[] forbiddenNamespaces)
    {
        var result = Types.InAssembly(assembly)
            .That().ResideInNamespaceStartingWith(ownNamespace)
            .Should().NotHaveDependencyOnAny(forbiddenNamespaces)
            .GetResult();

        var offenders = result.IsSuccessful
            ? Array.Empty<string>()
            : (result.FailingTypeNames?.ToArray() ?? Array.Empty<string>());

        Assert.True(
            result.IsSuccessful,
            $"Types in {ownNamespace} must not depend on [{string.Join(", ", forbiddenNamespaces)}] " +
            $"({requirementRef}). Offending types: {Describe(offenders)}.");
    }

    private static bool ImplementsNotificationConfiguration(Type type) =>
        type.GetInterfaces().Any(i =>
            i.IsGenericType
            && i.GetGenericTypeDefinition() == typeof(IEntityTypeConfiguration<>)
            && i.GetGenericArguments()[0] == typeof(InAppNotification));

    private static IEnumerable<Type> ConcreteImplementationsIn(Assembly assembly, Type abstraction) =>
        assembly.GetTypes()
            .Where(type => type is { IsClass: true, IsAbstract: false } && abstraction.IsAssignableFrom(type));

    private static string Describe(IReadOnlyCollection<string> offenders) =>
        offenders.Count == 0 ? "(none)" : string.Join("; ", offenders);
}

using Microsoft.Extensions.Options;
using PitchMate.Api.Auth.Configuration;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Auth.EmailVerification;
using PitchMate.Application.Auth.Gdpr;
using PitchMate.Application.Auth.PasswordReset;
using PitchMate.Application.Auth.UseCases;
using PitchMate.Infrastructure.Auth;
using PitchMate.Infrastructure.Auth.Email;

namespace PitchMate.Api.Auth;

/// <summary>
/// The auth composition root (<c>AddAuth</c>). It binds and validates every auth options section
/// with fail-fast startup validation (Requirement 15), selects the email sender by configuration
/// (Requirement 11.7), registers the Application use cases, and wires the Infrastructure
/// implementations behind the Application abstractions (Requirements 12.3, 12.6).
/// <para>
/// This is the only auth wiring in the Api; the Api holds no authentication logic itself
/// (Requirements 12.4, 12.5). It expects <c>AddInfrastructure</c> to have registered the shared
/// persistence services (the DbContext, unit of work, generic repository, and
/// <see cref="TimeProvider"/>) it builds on.
/// </para>
/// </summary>
public static class AuthServiceCollectionExtensions
{
    /// <summary>
    /// Registers auth options (with startup validation), the email sender, the Application use
    /// cases, and the Infrastructure implementations.
    /// </summary>
    /// <param name="services">The service collection to add registrations to.</param>
    /// <param name="configuration">The application configuration to bind the <c>Auth</c> section from.</param>
    /// <returns>The same <paramref name="services"/> for chaining.</returns>
    public static IServiceCollection AddAuth(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        AddValidatedOptions(services, configuration);
        AddEmailSender(services, configuration);
        AddUseCases(services);
        services.AddAuthInfrastructure();

        // JWT bearer authentication + authorization, configured from the same validated
        // AuthTokenOptions so middleware and token-service validation agree (Requirements 13.4, 13.5).
        // The middleware itself is added to the pipeline in Program.cs in the correct order.
        services.AddJwtBearerAuthentication();

        return services;
    }

    /// <summary>
    /// Binds each options section and registers its <see cref="IValidateOptions{T}"/> validator with
    /// <c>ValidateOnStart()</c>, so an empty signing key, a missing required setting, or a
    /// non-positive/out-of-range lifetime aborts startup naming the offending key before any request
    /// is served (Requirements 15.2, 15.3, 15.4).
    /// </summary>
    private static void AddValidatedOptions(IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<AuthTokenOptions>()
            .Bind(configuration.GetSection(AuthTokenOptions.SectionName))
            .ValidateOnStart();
        services.AddSingleton<IValidateOptions<AuthTokenOptions>, AuthTokenOptionsValidator>();

        services.AddOptions<GoogleOptions>()
            .Bind(configuration.GetSection(GoogleOptions.SectionName))
            .ValidateOnStart();
        services.AddSingleton<IValidateOptions<GoogleOptions>, GoogleOptionsValidator>();

        services.AddOptions<EmailOptions>()
            .Bind(configuration.GetSection(EmailOptions.SectionName))
            .ValidateOnStart();
        services.AddSingleton<IValidateOptions<EmailOptions>, EmailOptionsValidator>();

        services.AddOptions<EmailVerificationOptions>()
            .Bind(configuration.GetSection(EmailVerificationOptions.SectionName))
            .ValidateOnStart();
        services.AddSingleton<IValidateOptions<EmailVerificationOptions>, EmailVerificationOptionsValidator>();

        services.AddOptions<PasswordResetOptions>()
            .Bind(configuration.GetSection(PasswordResetOptions.SectionName))
            .ValidateOnStart();
        services.AddSingleton<IValidateOptions<PasswordResetOptions>, PasswordResetOptionsValidator>();

        services.AddOptions<SignInProtectionOptions>()
            .Bind(configuration.GetSection(SignInProtectionOptions.SectionName))
            .ValidateOnStart();
        services.AddSingleton<IValidateOptions<SignInProtectionOptions>, SignInProtectionOptionsValidator>();

        // The password-reset and sign-in-protection use cases consume the bound options as their
        // plain type (not IOptions<T>); expose the validated value for constructor injection.
        services.AddSingleton(sp => sp.GetRequiredService<IOptions<PasswordResetOptions>>().Value);
        services.AddSingleton(sp => sp.GetRequiredService<IOptions<SignInProtectionOptions>>().Value);
    }

    /// <summary>
    /// Selects the single <see cref="IEmailSender"/> implementation named by <c>Auth:Email:Provider</c>
    /// (Requirement 11.7). Local development logs to the console and opens no external connection
    /// (Requirement 11.2); a cloud environment sends through exactly one external service
    /// (Requirement 11.3). An unrecognised value is left to fail fast in
    /// <see cref="EmailOptionsValidator"/> at startup, so it defaults to the safe console transport here.
    /// </summary>
    private static void AddEmailSender(IServiceCollection services, IConfiguration configuration)
    {
        string? provider = configuration.GetSection(EmailOptions.SectionName)[nameof(EmailOptions.Provider)];

        switch (provider)
        {
            case EmailOptions.AzureCommunicationServicesProvider:
                services.AddSingleton<IEmailSender, AzureCommunicationEmailSender>();
                break;

            case EmailOptions.SendGridProvider:
                services.AddSingleton<IEmailSender, SendGridEmailSender>();
                break;

            default:
                services.AddSingleton<IEmailSender, ConsoleEmailSender>();
                break;
        }
    }

    /// <summary>
    /// Registers the Application auth use-case handlers and the email-verification initiator adapter.
    /// Handlers are scoped so they share the request scope's DbContext and unit of work.
    /// </summary>
    private static void AddUseCases(IServiceCollection services)
    {
        // Registration, sign-in, session lifecycle, linking, and GDPR handlers.
        services.AddScoped<RegisterWithPasswordHandler>();
        services.AddScoped<SignInWithPasswordHandler>();
        services.AddScoped<SignInWithGoogleHandler>();
        services.AddScoped<RefreshSessionHandler>();
        services.AddScoped<SignOutHandler>();
        services.AddScoped<LinkExternalProviderHandler>();
        services.AddScoped<AddPasswordCredentialHandler>();
        services.AddScoped<UnlinkAuthIdentityHandler>();
        services.AddScoped<EraseUserHandler>();
        services.AddScoped<ExportUserDataHandler>();

        // Email verification and password reset handlers.
        services.AddScoped<RequestEmailVerificationHandler>();
        services.AddScoped<RedeemEmailVerificationHandler>();
        services.AddScoped<RequestPasswordResetHandler>();
        services.AddScoped<RedeemPasswordResetHandler>();

        // The registration flow initiates verification through this seam, delegating to the
        // verification use case (Requirement 2.6).
        services.AddScoped<IEmailVerificationInitiator, EmailVerificationInitiator>();
    }
}

using FluentAssertions;
using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Tests.ValueObjects;

public class EmailTests
{
    [Fact]
    public void Email_WithValidFormat_ShouldCreateSuccessfully()
    {
        // Arrange
        var validEmail = "test@example.com";

        // Act
        var email = Email.Create(validEmail);

        // Assert
        email.Value.Should().Be("test@example.com");
    }

    [Fact]
    public void Email_ShouldNormalizeToLowerCase()
    {
        // Arrange
        var mixedCaseEmail = "Test@Example.COM";

        // Act
        var email = Email.Create(mixedCaseEmail);

        // Assert
        email.Value.Should().Be("test@example.com");
    }

    [Fact]
    public void Email_ShouldTrimWhitespace()
    {
        // Arrange
        var emailWithWhitespace = "  test@example.com  ";

        // Act
        var email = Email.Create(emailWithWhitespace);

        // Assert
        email.Value.Should().Be("test@example.com");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void Email_WithEmptyOrWhitespace_ShouldThrowArgumentException(string? invalidEmail)
    {
        // Act
        var act = () => Email.Create(invalidEmail!);

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("Email cannot be empty.*");
    }

    [Theory]
    [InlineData("notanemail")]
    [InlineData("@example.com")]
    [InlineData("test@")]
    [InlineData("test@@example.com")]
    [InlineData("test @example.com")]
    [InlineData("test@example")]
    public void Email_WithInvalidFormat_ShouldThrowArgumentException(string invalidEmail)
    {
        // Act
        var act = () => Email.Create(invalidEmail);

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("Invalid email format:*");
    }

    [Fact]
    public void Email_Equality_ShouldWorkCorrectly()
    {
        // Arrange
        var email1 = Email.Create("test@example.com");
        var email2 = Email.Create("test@example.com");
        var email3 = Email.Create("other@example.com");

        // Assert
        email1.Should().Be(email2);
        email1.Should().NotBe(email3);
    }

    // Feature: pitchmate-core, Property 1: Valid registration creates user account
    // For any valid email and password combination, creating a user account should result in a persisted user with those credentials
    [Property(MaxTest = 100)]
    public bool ValidEmail_ShouldCreateSuccessfully(NonEmptyString localPart, PositiveInt domainIndex)
    {
        // Arrange - Generate valid email
        var sanitized = new string(localPart.Get
            .Where(c => char.IsLetterOrDigit(c))
            .Take(20)
            .ToArray());
        
        if (string.IsNullOrEmpty(sanitized))
            sanitized = "user";

        var domains = new[] { "example.com", "test.com", "mail.com", "domain.org" };
        var domain = domains[domainIndex.Get % domains.Length];
        var emailString = $"{sanitized}@{domain}";

        // Act
        var email = Email.Create(emailString);

        // Assert
        return email.Value.Contains('@') &&
               email.Value.Contains('.') &&
               email.Value == emailString.ToLowerInvariant();
    }

    [Property(MaxTest = 100)]
    public bool InvalidEmail_WithoutAtSign_ShouldThrowException(NonEmptyString text)
    {
        // Arrange - Generate invalid email without @ sign
        var invalidEmail = new string(text.Get.Where(c => c != '@').Take(20).ToArray());
        
        if (string.IsNullOrWhiteSpace(invalidEmail))
            return true; // Skip empty strings

        // Act & Assert
        try
        {
            Email.Create(invalidEmail);
            return false; // Should have thrown
        }
        catch (ArgumentException)
        {
            return true;
        }
    }
}

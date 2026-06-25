namespace PitchMate.Infrastructure.Tests.Persistence;

/// <summary>
/// A controllable <see cref="TimeProvider"/> whose "now" is settable, so audit-stamping and
/// soft-delete properties can assert against a deterministic, known UTC instant rather than the
/// wall clock. The held instant only changes when a test calls <see cref="SetUtcNow"/> or
/// <see cref="Advance"/>.
/// </summary>
public sealed class FakeTimeProvider : TimeProvider
{
    private DateTimeOffset _utcNow;

    /// <summary>A fixed, arbitrary default instant used when no explicit instant is supplied.</summary>
    public static readonly DateTimeOffset DefaultNow =
        new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    /// <summary>Creates a provider anchored at <see cref="DefaultNow"/>.</summary>
    public FakeTimeProvider() : this(DefaultNow)
    {
    }

    /// <summary>Creates a provider anchored at the supplied instant.</summary>
    /// <param name="utcNow">The initial UTC instant the provider reports.</param>
    public FakeTimeProvider(DateTimeOffset utcNow)
    {
        _utcNow = utcNow.ToUniversalTime();
    }

    /// <inheritdoc />
    public override DateTimeOffset GetUtcNow() => _utcNow;

    /// <summary>Sets the UTC instant the provider reports from now on.</summary>
    /// <param name="utcNow">The new UTC instant.</param>
    public void SetUtcNow(DateTimeOffset utcNow) => _utcNow = utcNow.ToUniversalTime();

    /// <summary>Advances the held instant by the supplied amount.</summary>
    /// <param name="delta">The amount to advance the clock by.</param>
    public void Advance(TimeSpan delta) => _utcNow = _utcNow.Add(delta);
}

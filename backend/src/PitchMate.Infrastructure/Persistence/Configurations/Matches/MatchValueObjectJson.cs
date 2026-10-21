using System.Linq.Expressions;
using System.Reflection;
using System.Text.Json;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using PitchMate.Domain.Matches;

namespace PitchMate.Infrastructure.Persistence.Configurations.Matches;

/// <summary>
/// Serialises the match aggregate's immutable value objects — the <see cref="CandidateDay"/>
/// collection, the captured <see cref="KickoffLineup"/>, and the recorded <see cref="MatchResult"/>
/// — to and from <c>jsonb</c> columns, supplying the EF Core <see cref="ValueConverter{TModel,TProvider}"/>
/// and <see cref="ValueComparer{T}"/> pairs the match configuration applies.
/// <para>
/// These Domain types are deliberately shaped for the aggregate, not for persistence:
/// <see cref="CandidateDay"/> and the result's team scores are value-equality structs, and the
/// <see cref="KickoffLineup"/> is captured through an aggregate-internal factory. Rather than push
/// framework concerns back into Domain, this helper keeps the entire mapping in Infrastructure
/// (per the steering "persistence concerns stay in Infrastructure"): each value object is stored as
/// an opaque JSON document reconstructed through the accessible constructors — public for
/// <see cref="MatchResult"/>/<see cref="TeamScore"/>/<see cref="CandidateDay"/>, the
/// <see langword="internal"/> constructor for <see cref="KickoffTeam"/> (visible to this assembly),
/// and the aggregate's non-public constructor for <see cref="KickoffLineup"/> via a cached compiled
/// factory. The value comparers deep-copy through the same round-trip so EF change tracking treats
/// the stored documents as immutable snapshots.
/// </para>
/// </summary>
internal static class MatchValueObjectJson
{
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// Reconstructs a <see cref="KickoffLineup"/> from its captured teams. The aggregate exposes no
    /// public factory for a lineup (it is only ever captured from working teams at lock), so the
    /// non-public constructor taking the teams is invoked through a compiled delegate cached once.
    /// </summary>
    private static readonly Func<IEnumerable<KickoffTeam>, KickoffLineup> KickoffLineupFactory =
        BuildKickoffLineupFactory();

    /// <summary>The converter mapping a match's candidate-day collection to a <c>jsonb</c> array of instants.</summary>
    public static ValueConverter<IReadOnlyCollection<CandidateDay>, string> CandidateDaysConverter() =>
        new(days => SerializeCandidateDays(days), json => DeserializeCandidateDays(json));

    /// <summary>The comparer that treats a candidate-day collection as an immutable, deep-copied snapshot.</summary>
    public static ValueComparer<IReadOnlyCollection<CandidateDay>> CandidateDaysComparer() =>
        new(
            (left, right) => SerializeCandidateDays(left) == SerializeCandidateDays(right),
            value => SerializeCandidateDays(value).GetHashCode(),
            value => DeserializeCandidateDays(SerializeCandidateDays(value)));

    /// <summary>The converter mapping a captured <see cref="KickoffLineup"/> to a <c>jsonb</c> document.</summary>
    public static ValueConverter<KickoffLineup, string> KickoffLineupConverter() =>
        new(lineup => SerializeLineup(lineup), json => DeserializeLineup(json));

    /// <summary>The comparer that treats a captured <see cref="KickoffLineup"/> as an immutable, deep-copied snapshot.</summary>
    public static ValueComparer<KickoffLineup> KickoffLineupComparer() =>
        new(
            (left, right) => SerializeLineup(left) == SerializeLineup(right),
            value => SerializeLineup(value).GetHashCode(),
            value => DeserializeLineup(SerializeLineup(value)));

    /// <summary>The converter mapping a recorded <see cref="MatchResult"/> to a <c>jsonb</c> document.</summary>
    public static ValueConverter<MatchResult, string> MatchResultConverter() =>
        new(result => SerializeResult(result), json => DeserializeResult(json));

    /// <summary>The comparer that treats a recorded <see cref="MatchResult"/> as an immutable, deep-copied snapshot.</summary>
    public static ValueComparer<MatchResult> MatchResultComparer() =>
        new(
            (left, right) => SerializeResult(left) == SerializeResult(right),
            value => SerializeResult(value).GetHashCode(),
            value => DeserializeResult(SerializeResult(value)));

    private static string SerializeCandidateDays(IReadOnlyCollection<CandidateDay>? days)
    {
        var instants = (days ?? []).Select(day => day.Instant).ToList();
        return JsonSerializer.Serialize(instants, SerializerOptions);
    }

    /// <summary>
    /// Rehydrates a match's candidate-day collection from the <c>candidate_days</c> document.
    /// <para>
    /// <see langword="internal"/> rather than private so a raw-SQL query source inside this assembly
    /// — which reads the <c>jsonb</c> column as <c>::text</c> because an unmapped row type admits
    /// only provider-mappable scalars — rehydrates it through the <em>same</em> code the entity
    /// configuration's <see cref="ValueConverter{TModel,TProvider}"/> uses, so the read path and the
    /// write path cannot drift.
    /// </para>
    /// </summary>
    internal static IReadOnlyCollection<CandidateDay> DeserializeCandidateDays(string json)
    {
        var instants = JsonSerializer.Deserialize<List<DateTimeOffset>>(json, SerializerOptions) ?? [];
        return instants.Select(instant => new CandidateDay(instant)).ToList();
    }

    private static string SerializeLineup(KickoffLineup? lineup)
    {
        var dto = new KickoffLineupDto(
            (lineup?.Teams ?? []).Select(team =>
                new KickoffTeamDto(team.TeamId, team.TeamName, team.BibFlag, team.ParticipantMembershipIds.ToList())).ToList());
        return JsonSerializer.Serialize(dto, SerializerOptions);
    }

    /// <summary>
    /// Rehydrates a captured <see cref="KickoffLineup"/> from the <c>kickoff_lineup</c> document.
    /// <para>
    /// <see langword="internal"/> for the same reason as <see cref="DeserializeCandidateDays"/>: an
    /// in-assembly query source reading the column as <c>::text</c> reconstructs the lineup through
    /// the same aggregate-internal factory the entity configuration relies on.
    /// </para>
    /// </summary>
    internal static KickoffLineup DeserializeLineup(string json)
    {
        var dto = JsonSerializer.Deserialize<KickoffLineupDto>(json, SerializerOptions)
            ?? new KickoffLineupDto([]);
        var teams = dto.Teams.Select(team =>
            new KickoffTeam(team.TeamId, team.TeamName, team.BibFlag, team.ParticipantMembershipIds));
        return KickoffLineupFactory(teams);
    }

    private static string SerializeResult(MatchResult? result)
    {
        var dto = new MatchResultDto(
            result?.Fidelity ?? ResultFidelity.Basic,
            (result?.TeamScores ?? []).Select(score => new TeamScoreDto(score.TeamId, score.Score)).ToList());
        return JsonSerializer.Serialize(dto, SerializerOptions);
    }

    /// <summary>
    /// Rehydrates a recorded <see cref="MatchResult"/> from the <c>recorded_result</c> document.
    /// <para>
    /// <see langword="internal"/> for the same reason as <see cref="DeserializeCandidateDays"/>, so
    /// a query source reading the column as <c>::text</c> produces exactly the result the entity
    /// configuration would have materialised.
    /// </para>
    /// </summary>
    internal static MatchResult DeserializeResult(string json)
    {
        var dto = JsonSerializer.Deserialize<MatchResultDto>(json, SerializerOptions)
            ?? new MatchResultDto(ResultFidelity.Basic, []);
        var scores = dto.TeamScores.Select(score => new TeamScore(score.TeamId, score.Score));
        return new MatchResult(dto.Fidelity, scores);
    }

    private static Func<IEnumerable<KickoffTeam>, KickoffLineup> BuildKickoffLineupFactory()
    {
        var constructor = typeof(KickoffLineup).GetConstructor(
            BindingFlags.Instance | BindingFlags.NonPublic,
            binder: null,
            types: [typeof(IEnumerable<KickoffTeam>)],
            modifiers: null)
            ?? throw new InvalidOperationException(
                "KickoffLineup does not expose the expected (IEnumerable<KickoffTeam>) constructor for persistence reconstruction.");

        var parameter = Expression.Parameter(typeof(IEnumerable<KickoffTeam>), "teams");
        var body = Expression.New(constructor, parameter);
        return Expression.Lambda<Func<IEnumerable<KickoffTeam>, KickoffLineup>>(body, parameter).Compile();
    }

    private sealed record KickoffLineupDto(IReadOnlyList<KickoffTeamDto> Teams);

    private sealed record KickoffTeamDto(Guid TeamId, string TeamName, bool BibFlag, IReadOnlyList<Guid> ParticipantMembershipIds);

    private sealed record MatchResultDto(ResultFidelity Fidelity, IReadOnlyList<TeamScoreDto> TeamScores);

    private sealed record TeamScoreDto(Guid TeamId, int Score);
}

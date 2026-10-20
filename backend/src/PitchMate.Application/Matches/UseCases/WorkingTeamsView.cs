namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A match's working teams as the working-teams read reports them to an organiser (match-read-models
/// Requirement 4): the teams the aggregate holds, the predicted outcome of that split, and the
/// participants on no team.
/// <para>
/// <b>Organisers only — deliberately.</b> A plain member can read the locked team sheet but not this
/// provisional arrangement: the working teams are an admin's work in progress, the team sheet is the
/// published artefact. The deciding factor is <see cref="Prediction"/>, whose disclosure is justified
/// only because <c>POST /matches/{matchId}/teams/proposal</c> already publishes the same quantities to
/// the same organiser audience (Requirements 5.2, 6.6).
/// </para>
/// <para>
/// The arrangement is reported <b>verbatim</b>: exactly the teams the aggregate holds, reconciled
/// against neither the participants nor the kickoff lineup, so it is the arrangement the team-editing
/// writes address (Requirements 4.12, 4.14). It carries no μ, σ or rating of any kind (Requirement 6.1).
/// </para>
/// </summary>
/// <param name="Teams">The working teams in creation order; empty when no team has been rolled.</param>
/// <param name="Prediction">
/// The engine's prediction for the split, or <see langword="null"/> when there are fewer than two teams
/// or a team has an empty roster — the arrangements the engine does not accept (Requirement 4.11).
/// </param>
/// <param name="UnassignedParticipants">
/// The participants on no team, in roster-position order — a participant added after the teams were
/// rolled sits here until the next roll. A distinct collection, never a pseudo-team (Requirement 4.13).
/// </param>
public sealed record WorkingTeamsView(
    IReadOnlyList<WorkingTeamView> Teams,
    SplitPrediction? Prediction,
    IReadOnlyList<Guid> UnassignedParticipants);

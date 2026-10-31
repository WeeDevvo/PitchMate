namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Turns the rating engine's win probability into the share organisers see, so each team's win plus
/// the draw together make the whole outcome.
/// <para>
/// The engine's win probabilities are OpenSkill's <c>predict_win</c>, which ignores draws and sums to 1
/// on its own, while <c>predict_draw</c> is computed independently. Shown side by side they overstate
/// the total (51% + 5% + 49%). Each win is therefore scaled by <c>1 − draw</c>, so the wins and the
/// draw sum to 1 and the teams keep their relative strength. This is presentational only: the balancer
/// still judges splits on the engine's own numbers. It deals in plain numbers so that neither read
/// model (the working teams' <see cref="SplitPrediction"/>, the balancer's proposal) depends on the
/// other.
/// </para>
/// </summary>
internal static class OutcomeShares
{
    /// <summary>A team's share of the whole outcome, from its engine win probability and the draw.</summary>
    public static double Win(double winProbability, double drawProbability) => winProbability * (1.0 - drawProbability);
}

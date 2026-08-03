using PitchMate.Application.Matches.Abstractions;

namespace PitchMate.Infrastructure.Matches;

/// <summary>
/// Default implementation of <see cref="ISillyNameGenerator"/> that draws a light-hearted, football
/// themed team name by pairing a random adjective with a random noun from curated word lists
/// (Requirement 8.4, <c>product.md</c> "Match presentation"). Successive calls draw independently and
/// may repeat.
///
/// <para>
/// Names are formatted as "<c>Adjective Noun</c>". Both word lists are kept short enough that every
/// generated name stays comfortably within the 1–50 trimmed-character range that team names are
/// validated against elsewhere. Randomness comes from <see cref="Random.Shared"/>, which is
/// thread-safe, so the generator carries no mutable state and can be registered as a singleton.
/// </para>
/// </summary>
public sealed class SillyNameGenerator : ISillyNameGenerator
{
    private static readonly string[] Adjectives =
    [
        "Agile",
        "Airborne",
        "Ballistic",
        "Blazing",
        "Bold",
        "Bouncing",
        "Brutal",
        "Chaotic",
        "Cheeky",
        "Clever",
        "Crafty",
        "Crunching",
        "Daring",
        "Deadly",
        "Determined",
        "Dizzy",
        "Dominant",
        "Electric",
        "Elite",
        "Explosive",
        "Fearless",
        "Ferocious",
        "Flying",
        "Galloping",
        "Golden",
        "Gritty",
        "Heroic",
        "Howling",
        "Hungry",
        "Hyper",
        "Icy",
        "Iron",
        "Jolly",
        "Legendary",
        "Lightning",
        "Lively",
        "Lucky",
        "Mighty",
        "Mischievous",
        "Muddy",
        "Nifty",
        "Nimble",
        "Noisy",
        "Phantom",
        "Powerful",
        "Raging",
        "Rampaging",
        "Rapid",
        "Reckless",
        "Relentless",
        "Restless",
        "Rowdy",
        "Savage",
        "Scrappy",
        "Sharp",
        "Shifty",
        "Silent",
        "Sly",
        "Sneaky",
        "Speedy",
        "Spicy",
        "Sprinting",
        "Steady",
        "Storming",
        "Swift",
        "Thunderous",
        "Turbo",
        "Unstoppable",
        "Vicious",
        "Wandering",
        "Wild",
        "Wonky",
        "Wobbly",
        "Zippy"
    ];

    private static readonly string[] Nouns =
    [
        "Armadillos",
        "Astronauts",
        "Badgers",
        "Bananas",
        "Bandits",
        "Barracudas",
        "Bears",
        "Beavers",
        "Bisons",
        "Bulldogs",
        "Cannons",
        "Cobras",
        "Comets",
        "Coyotes",
        "Cyclones",
        "Dinosaurs",
        "Dragons",
        "Dynamos",
        "Eagles",
        "Falcons",
        "Ferrets",
        "Foxes",
        "Gladiators",
        "Goats",
        "Hammerheads",
        "Hawks",
        "Hedgehogs",
        "Hornets",
        "Hurricanes",
        "Jaguars",
        "Jets",
        "Kangaroos",
        "Knights",
        "Lions",
        "Llamas",
        "Meerkats",
        "Meteors",
        "Monkeys",
        "Otters",
        "Owls",
        "Panthers",
        "Penguins",
        "Phoenixes",
        "Pigeons",
        "Pirates",
        "Pumas",
        "Raptors",
        "Rhinos",
        "Rockets",
        "Sharks",
        "Spartans",
        "Strikers",
        "Tigers",
        "Titans",
        "Tornadoes",
        "Toucans",
        "Vikings",
        "Vipers",
        "Warriors",
        "Wildcats",
        "Wizards",
        "Wolves",
        "Wombats",
        "Zebras"
    ];

    /// <inheritdoc />
    public string Next()
    {
        string adjective = Adjectives[Random.Shared.Next(Adjectives.Length)];
        string noun = Nouns[Random.Shared.Next(Nouns.Length)];
        return $"{adjective} {noun}";
    }
}

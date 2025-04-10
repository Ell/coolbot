import { createTool } from "../bot/tool";
import { z } from "zod";
import fetch from "node-fetch";

const POKEAPI_BASE_URL = "https://pokeapi.co/api/v2";

/**
 * Formats a description string to be more readable
 * Removes newlines and replaces them with spaces
 */
function formatDescription(description: string): string {
  return description
    .replace(/\f/g, " ")
    .replace(/\n/g, " ")
    .replace(/\r/g, " ")
    .replace(/\t/g, " ")
    .replace(/\v/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Capitalize the first letter of each word in a string
 */
function capitalize(str: string): string {
  return str
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Get data from the PokéAPI
 */
async function fetchFromPokeAPI(endpoint: string): Promise<any> {
  try {
    const response = await fetch(`${POKEAPI_BASE_URL}/${endpoint}`);

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Error fetching from PokéAPI: ${error}`);
    throw error;
  }
}

/**
 * Look up a Pokémon by name or ID number
 */
async function getPokemonInfo(nameOrId: string): Promise<string> {
  try {
    // Convert to lowercase for consistent API calls
    const query = nameOrId.toString().toLowerCase();

    // Fetch basic Pokémon data
    const pokemonData = await fetchFromPokeAPI(`pokemon/${query}`);

    // Fetch species data to get more details
    const speciesData = await fetchFromPokeAPI(
      `pokemon-species/${pokemonData.id}`
    );

    // Extract the English flavor text (description)
    const englishFlavorText = speciesData.flavor_text_entries.find(
      (entry: any) => entry.language.name === "en"
    );

    const description = englishFlavorText
      ? formatDescription(englishFlavorText.flavor_text)
      : "No description available.";

    // Format types
    const types = pokemonData.types
      .map((typeInfo: any) => capitalize(typeInfo.type.name))
      .join("/");

    // Format abilities
    const abilities = pokemonData.abilities
      .map((abilityInfo: any) => {
        const abilityName = capitalize(abilityInfo.ability.name);
        return abilityInfo.is_hidden ? `${abilityName} (Hidden)` : abilityName;
      })
      .join(", ");

    // Construct response
    return `#${pokemonData.id} ${capitalize(
      pokemonData.name
    )} | Type: ${types} | Height: ${pokemonData.height / 10}m | Weight: ${
      pokemonData.weight / 10
    }kg | Abilities: ${abilities} | ${description}`;
  } catch (error) {
    console.error(`Error looking up Pokémon: ${error}`);
    return `Could not find information for Pokémon: ${nameOrId}`;
  }
}

/**
 * Find Pokémon by type
 */
async function getPokemonByType(type: string): Promise<string> {
  try {
    // Convert to lowercase for consistent API calls
    const query = type.toString().toLowerCase();

    const typeData = await fetchFromPokeAPI(`type/${query}`);

    // Get up to 10 Pokémon of this type
    const pokemonList = typeData.pokemon
      .slice(0, 10)
      .map((pokemonInfo: any) => {
        const url = pokemonInfo.pokemon.url;
        const id = url.split("/").filter(Boolean).pop();
        return `#${id} ${capitalize(pokemonInfo.pokemon.name)}`;
      })
      .join(", ");

    const totalCount = typeData.pokemon.length;
    const suffix =
      totalCount > 10 ? ` (${totalCount - 10} more not shown)` : "";

    return `${capitalize(type)} type Pokémon: ${pokemonList}${suffix}`;
  } catch (error) {
    console.error(`Error finding Pokémon by type: ${error}`);
    return `Could not find Pokémon with type: ${type}`;
  }
}

/**
 * Find Pokémon by generation
 */
async function getPokemonByGeneration(generation: number): Promise<string> {
  try {
    if (generation < 1 || generation > 9) {
      return "Please provide a generation number between 1 and 9.";
    }

    const genData = await fetchFromPokeAPI(`generation/${generation}`);

    // Get information about the generation
    const regionName = capitalize(genData.main_region.name);

    // Get up to 10 Pokémon from this generation
    const pokemonList = genData.pokemon_species
      .slice(0, 10)
      .map((species: any) => {
        const id = species.url.split("/").filter(Boolean).pop();
        return `#${id} ${capitalize(species.name)}`;
      })
      .join(", ");

    const totalCount = genData.pokemon_species.length;
    const suffix =
      totalCount > 10 ? ` (${totalCount - 10} more not shown)` : "";

    return `Generation ${generation} (${regionName} region) Pokémon: ${pokemonList}${suffix}`;
  } catch (error) {
    console.error(`Error finding Pokémon by generation: ${error}`);
    return `Could not find Pokémon from generation: ${generation}`;
  }
}

/**
 * Get random Pokémon facts
 */
async function getRandomPokemonFact(): Promise<string> {
  try {
    // Generate a random Pokémon ID (currently up to Gen 8)
    const randomId = Math.floor(Math.random() * 898) + 1;

    // Fetch the random Pokémon
    const pokemonData = await fetchFromPokeAPI(`pokemon/${randomId}`);
    const speciesData = await fetchFromPokeAPI(`pokemon-species/${randomId}`);

    // Get interesting facts
    const name = capitalize(pokemonData.name);

    // Find an English flavor text
    const englishFlavorText = speciesData.flavor_text_entries.find(
      (entry: any) => entry.language.name === "en"
    );

    const description = englishFlavorText
      ? formatDescription(englishFlavorText.flavor_text)
      : "No description available.";

    // Get generation info
    const genNumber = speciesData.generation.url
      .split("/")
      .filter(Boolean)
      .pop();

    // Format types
    const types = pokemonData.types
      .map((typeInfo: any) => capitalize(typeInfo.type.name))
      .join("/");

    return `Random Pokémon Fact: #${randomId} ${name} (Gen ${genNumber}) is a ${types} type. ${description}`;
  } catch (error) {
    console.error(`Error getting random Pokémon fact: ${error}`);
    return "Could not retrieve a random Pokémon fact. Please try again.";
  }
}

// Tool to look up a Pokémon by name or ID
export const pokemonLookupTool = createTool(
  "pokemon_lookup",
  "Look up information about a specific Pokémon by name or Pokédex number",
  z.object({
    nameOrId: z
      .string()
      .describe("The name or Pokédex number of the Pokémon to look up"),
  }),
  async ({ nameOrId }: { nameOrId: string }) => {
    try {
      return await getPokemonInfo(nameOrId);
    } catch (error: any) {
      console.error("Pokémon lookup tool error:", error);
      return `Error looking up Pokémon: ${error.message}`;
    }
  }
);

// Tool to find Pokémon by type
export const pokemonByTypeTool = createTool(
  "pokemon_by_type",
  "Find Pokémon of a specific type (e.g., fire, water, grass, electric)",
  z.object({
    type: z.string().describe("The type of Pokémon to search for"),
  }),
  async ({ type }: { type: string }) => {
    try {
      return await getPokemonByType(type);
    } catch (error: any) {
      console.error("Pokémon by type tool error:", error);
      return `Error finding Pokémon by type: ${error.message}`;
    }
  }
);

// Tool to find Pokémon by generation
export const pokemonByGenerationTool = createTool(
  "pokemon_by_generation",
  "Find Pokémon from a specific generation (1-9)",
  z.object({
    generation: z
      .number()
      .min(1)
      .max(9)
      .describe("The generation number (1-9)"),
  }),
  async ({ generation }: { generation: number }) => {
    try {
      return await getPokemonByGeneration(generation);
    } catch (error: any) {
      console.error("Pokémon by generation tool error:", error);
      return `Error finding Pokémon by generation: ${error.message}`;
    }
  }
);

// Tool to get random Pokémon facts
export const pokemonRandomFactTool = createTool(
  "pokemon_random_fact",
  "Get a random fact about a Pokémon",
  z.object({}),
  async () => {
    try {
      return await getRandomPokemonFact();
    } catch (error: any) {
      console.error("Random Pokémon fact tool error:", error);
      return `Error getting random Pokémon fact: ${error.message}`;
    }
  }
);

export default {
  pokemon_lookup: pokemonLookupTool,
  pokemon_by_type: pokemonByTypeTool,
  pokemon_by_generation: pokemonByGenerationTool,
  pokemon_random_fact: pokemonRandomFactTool,
};

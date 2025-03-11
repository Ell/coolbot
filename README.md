# CoolBot - IRC Bot powered by Claude

CoolBot is an IRC bot that uses Anthropic's Claude AI model to generate responses in IRC channels and private messages.

## Features

- Connect to multiple IRC networks simultaneously
- Respond to direct messages and channel mentions
- Configurable rate limiting to avoid spam
- Extensible with custom tools
- Uses Anthropic's Claude for AI-powered responses
- Weather lookup via PirateWeather API
- Location geocoding via Google Maps API
- 📝 **GitHub Gist content fetching** - Fetch content from GitHub Gists by URL
- 🚀 **Code execution** - Execute code in 30+ programming languages via the Piston API
- 🧠 **User facts memory** - Remember and recall facts about IRC users

## Installation

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a configuration file:
   ```
   cp config.json.example config.json
   ```
4. Edit the `config.json` file to add your IRC server details

## Configuration

The `config.json` file contains all the settings for the bot:

- `irc`: Configuration for IRC networks
  - Each network has its own configuration with:
    - `host`: IRC server hostname
    - `port`: IRC server port (usually 6667 for plain, 6697 for SSL)
    - `nicknames`: Array of nicknames to try
    - `username`: IRC username
    - `realname`: IRC realname/gecos
    - `password`: Server password (if required)
    - `sasl`: SASL authentication settings (if required)
    - `rateLimit`: Rate limiting settings
      - `messages`: Number of messages allowed in a period
      - `period`: Time period in milliseconds
    - `channels`: Array of channels to join
      - Simple format: `"#channel"`
      - Advanced format: `{"#channel": {options}}`
        - `autoJoin`: Whether to join this channel (boolean)
        - `ignoredNicks`: Array of usernames to ignore
        - `commandBlacklist`: Array of commands not allowed in this channel

See `config.json.example` for a complete example.

## Required API Keys

To use the weather and geocoding features, you'll need to obtain the following API keys:

1. **PirateWeather API**: A free alternative to the Dark Sky API
   - Visit [pirateweather.net](https://pirateweather.net/) to learn more
   - Register and obtain your API key

2. **Google Maps Geocoding API**:
   - Go to the [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or use an existing one
   - Enable the Geocoding API
   - Create an API key restricted to the Geocoding API

You'll need to provide these API keys when using the weather tools.

## Usage

1. Set your Anthropic API key:
   ```
   export ANTHROPIC_API_KEY=your-api-key
   ```

2. Run the bot:
   ```
   npm start
   ```

   Or with a specific config file:
   ```
   npm start -- /path/to/config.json
   ```

## Commands

In IRC channels, the bot responds when mentioned directly:

- `coolbot: What's the weather like?`
- `coolbot, tell me a joke`
- `coolbot help me with this problem`

In private messages, you can talk to the bot directly without prefixing your messages.

### Weather Examples

The bot now supports weather lookups. Some examples:

- `coolbot: What's the weather like in San Francisco?`
- `coolbot: Tell me the weather forecast for New York City`
- `coolbot: How hot is it in Tokyo right now?`

### GitHub Gist Examples

The bot can retrieve and display content from GitHub Gists:

- `coolbot: Show me the code in this gist: https://gist.github.com/username/abc123`
- `coolbot: Can you look at this gist and explain what it does? https://gist.github.com/username/abc123`
- `coolbot: What files are in this multi-file gist? https://gist.github.com/username/abc123`

## Available Tools

### Weather and Geocoding

The bot includes several tools for weather and location information:

1. **geolocate** - Convert a location name to geographic coordinates using Google Maps API
2. **get_weather** - Get the current weather for a location using PirateWeather API
3. **weather_lookup** - Combined tool that geocodes a location and fetches weather data

### GitHub Gist Tools

These tools allow the bot to fetch content from GitHub Gists, which are a simple way to share code snippets and text.

### Examples

```
!bot Fetch the code from this Gist: https://gist.github.com/username/abc123 and explain what it does
!bot List all the files in this Gist: https://gist.github.com/username/xyz789
```

### Available Tools

1. **fetch_gist** - Fetches content from a Gist URL
   - Parameters:
     - `gist_url` (string, required): URL of the GitHub Gist to fetch
     - `max_size` (number, optional): Maximum size in bytes to retrieve (default: 100000)
   - Features:
     - Supports both regular and raw Gist URLs
     - Works with single-file and multi-file Gists
     - Automatically fetches the raw content
     - Handles errors gracefully

2. **list_gist_files** - Lists all files in a multi-file Gist
   - Parameters:
     - `gist_url` (string, required): URL of the GitHub Gist to list files from
   - Returns:
     - Metadata about the Gist (owner, creation date, etc.)
     - List of files with details (filename, language, size, raw URL)

## Code Execution Tools

These tools allow the bot to execute code in various programming languages using the Piston API.

### Examples

```
!bot Execute this Python code: print("Hello, World!")
!bot Run this JavaScript: console.log(2 + 2)
!bot List all programming languages you can execute
```

### Available Tools

1. **execute_code** - Executes code in a specified programming language
   - Parameters:
     - `language` (string, required): Programming language to use (e.g., python, javascript)
     - `code` (string, required): Source code to execute
     - `stdin` (string, optional): Standard input to provide to the program
     - `args` (array of strings, optional): Command-line arguments
     - `version` (string, optional): Specific language version (defaults to latest)
     - `compile_timeout` (number, optional): Compile stage timeout in ms (default: 10000)
     - `run_timeout` (number, optional): Run stage timeout in ms (default: 3000)
     - `memory_limit` (number, optional): Memory limit in bytes
   - Returns:
     - Execution results including stdout, stderr, exit code
     - Compilation output (for compiled languages)
     - Resource usage (execution time, memory)

2. **get_supported_languages** - Lists all available programming languages
   - Parameters: None required
   - Returns:
     - List of supported languages with their available versions

### Piston API

This tool uses the [Piston API](https://github.com/engineer-man/piston), a secure code execution engine that:
- Supports 30+ programming languages
- Runs code in isolated containers
- Enforces resource limits for security
- Provides detailed execution information

## User Facts Tools

These tools allow the bot to remember and recall facts about users in IRC channels, creating a memory of user information that can be referenced later.

### Examples

```
!bot Remember that alice is a software engineer
!bot Is alice a software engineer?
!bot What do you know about bob?
!bot Tell me a random fact about someone
```

### Available Tools

1. **remember_fact** - Stores a fact about a user in the database
   - Parameters:
     - `username` (string, required): The username to associate the fact with
     - `fact` (string, required): The fact to remember about the user
     - `network` (string, optional): IRC network identifier (defaults to all networks)
     - `channel` (string, optional): IRC channel name (defaults to all channels)
   - Returns:
     - Confirmation message that the fact was stored
     - The database ID of the stored fact

2. **lookup_fact** - Retrieves facts about a specific user
   - Parameters:
     - `username` (string, required): The username to look up facts for
     - `query` (string, optional): Specific fact to search for
     - `network` (string, optional): IRC network filter (defaults to all networks)
     - `channel` (string, optional): IRC channel filter (defaults to all channels)
     - `limit` (number, optional): Maximum number of facts to return (default: 5)
   - Returns:
     - List of facts about the user
     - Formatted message suitable for IRC display

3. **random_facts** - Returns random facts from the database
   - Parameters:
     - `network` (string, optional): IRC network filter (defaults to all networks)
     - `channel` (string, optional): IRC channel filter (defaults to all channels)
     - `limit` (number, optional): Maximum number of facts to return (default: 5)
   - Returns:
     - List of random facts
     - Formatted message suitable for IRC display

### Implementation Details

The user facts system uses SQLite to store facts persistently, allowing the bot to maintain memory across restarts. Facts are stored with context information (network, channel) and can be filtered accordingly when retrieving.

## Development

- Build: `npm run build`
- Lint: `npm run lint`
- Test: `npm run test`

## License

MIT

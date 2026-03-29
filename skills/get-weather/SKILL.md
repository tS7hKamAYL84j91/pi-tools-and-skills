---
name: get-weather
description: Fetch current weather for any city. Use when the user asks about weather, temperature, or conditions in a specific location.
---

# Get Weather

Fetch current weather conditions for any city using wttr.in.

## Usage

```bash
scripts/get-weather.sh "City Name"
```

The city name can include country code for disambiguation:

```bash
scripts/get-weather.sh "Paris,France"
scripts/get-weather.sh "Tokyo"
scripts/get-weather.sh "New York"
```

## Output Format

Returns a single line in the format:
```
City: Condition, Temperature
```

Example:
```
London: ☀️ Sunny, +15°C
```

## Examples

**User asks:** "What's the weather in Tokyo?"
**Response:** Run `scripts/get-weather.sh "Tokyo"` and report the result.

**User asks:** "Is it raining in London?"
**Response:** Run `scripts/get-weather.sh "London"` and check the conditions.
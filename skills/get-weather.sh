#!/bin/bash
# Description: Fetches the current weather for a given city
# Usage: ./skills/get-weather.sh "City Name"
curl -s "wttr.in/$1?format=3"
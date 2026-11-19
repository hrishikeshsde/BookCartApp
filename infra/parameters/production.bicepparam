// Parameters of the one environment (resource group rg-bookcart). Values that are secret are read from environment
// variables, so they are never in the repository (building this file fails if a required one is missing):
//   CONTAINER_IMAGE  the image to run (the infra workflow passes the one running now)
//   JWT_SECRET       the GitHub environment secret, at least 32 characters
//   GEMINI_API_KEY   optional
// The budget is not here: bootstrap.bicep creates it once.
using '../main.bicep'

param baseName = 'bookcart'
param location = 'centralindia'

param containerImage = readEnvironmentVariable('CONTAINER_IMAGE')
param jwtSecret = readEnvironmentVariable('JWT_SECRET')
param geminiApiKey = readEnvironmentVariable('GEMINI_API_KEY', '')

param enforceCsp = true

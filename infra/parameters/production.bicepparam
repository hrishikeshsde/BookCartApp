// Parameters of the one environment (resource group rg-bookcart). Values that are secret or personal are read from
// environment variables, so they are never in the repository:
//   CONTAINER_IMAGE  the image to run (the infra workflow passes the one running now)
//   JWT_SECRET       the GitHub environment secret, at least 32 characters
//   GEMINI_API_KEY   optional
//   BUDGET_EMAIL     who receives the budget alerts
using '../main.bicep'

param baseName = 'bookcart'
param location = 'centralindia'

param containerImage = readEnvironmentVariable('CONTAINER_IMAGE')
param jwtSecret = readEnvironmentVariable('JWT_SECRET')
param geminiApiKey = readEnvironmentVariable('GEMINI_API_KEY', '')

param enforceCsp = true

param budgetEmail = readEnvironmentVariable('BUDGET_EMAIL')
param budgetAmount = 1
// Set once, to the first day of the month A1 is first deployed (it must not change afterwards).
param budgetStartDate = '2026-12-01'

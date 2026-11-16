// BookCart on the Azure free tier (plan A1): everything the app needs, at zero cost.
//
//   App Service Free F1 (Linux) running the container from ghcr.io, a user-assigned identity for the app,
//   an Entra-only SQL server with the free-tier database, and a USD 1 budget alert.
//
// Run bootstrap.bicep once first (it creates the pipeline identity this template refers to). Then:
//   az deployment group what-if -g rg-bookcart -f infra/main.bicep -p infra/parameters/production.bicepparam
//   az deployment group create  -g rg-bookcart -f infra/main.bicep -p infra/parameters/production.bicepparam
// The parameter file reads the image, the secrets and the e-mail address from environment variables, so none of them
// is in the repository. Nothing secret is an output.

targetScope = 'resourceGroup'

@description('Lower-case letters and digits; part of every resource name.')
@minLength(3)
@maxLength(12)
param baseName string = 'bookcart'

param location string = resourceGroup().location

@description('The image the app runs, e.g. ghcr.io/<owner>/bookcart@sha256:<digest>. The infra workflow passes the one running now, so an infrastructure run never changes the version.')
param containerImage string

@secure()
@minLength(32)
@description('JWT signing key (at least 32 characters). From the GitHub environment secret JWT_SECRET.')
param jwtSecret string

@secure()
@description('Optional Google Gemini key (AI book summaries). Empty: no setting, and the summary endpoint answers 503.')
param geminiApiKey string = ''

@description('Enforce the Content-Security-Policy (D4 found no violations). false only reports violations.')
param enforceCsp bool = true

@description('Who receives the budget alerts.')
param budgetEmail string

@description('Monthly budget in the billing currency. The expected cost is zero, so any alert means a mistake.')
param budgetAmount int = 1

@description('First day of the month the budget starts, yyyy-MM-01 (the current month or later when it is created; it must not change afterwards).')
param budgetStartDate string

// Global names (web app, SQL server) carry a suffix derived from the resource group, so the same group always gets
// the same names and a second run changes nothing.
var suffix = take(uniqueString(resourceGroup().id), 6)

resource pipelineIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: 'id-${baseName}-pipeline'
}

resource appIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${baseName}-app'
  location: location
}

module sql 'modules/sql.bicep' = {
  name: 'sql'
  params: {
    location: location
    serverName: 'sql-${baseName}-${suffix}'
    adminLogin: pipelineIdentity.name
    adminObjectId: pipelineIdentity.properties.principalId
  }
}

module webapp 'modules/webapp.bicep' = {
  name: 'webapp'
  params: {
    location: location
    planName: 'plan-${baseName}'
    siteName: 'app-${baseName}-${suffix}'
    appIdentityId: appIdentity.id
    appIdentityClientId: appIdentity.properties.clientId
    containerImage: containerImage
    sqlServerFqdn: sql.outputs.serverFqdn
    databaseName: sql.outputs.databaseName
    jwtSecret: jwtSecret
    geminiApiKey: geminiApiKey
    enforceCsp: enforceCsp
  }
}

module budget 'modules/budget.bicep' = {
  name: 'budget'
  params: {
    name: 'budget-${baseName}'
    amount: budgetAmount
    startDate: budgetStartDate
    contactEmails: [
      budgetEmail
    ]
  }
}

// Names and addresses for the workflows and runbooks. Nothing secret.
output webAppName string = webapp.outputs.siteName
output webAppHostName string = webapp.outputs.hostName
output sqlServerName string = sql.outputs.serverName
output sqlServerFqdn string = sql.outputs.serverFqdn
output databaseName string = sql.outputs.databaseName
output appIdentityName string = appIdentity.name
output appIdentityClientId string = appIdentity.properties.clientId

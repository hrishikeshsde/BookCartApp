// One-time setup of the resource group, run BY YOU (an Owner of the subscription), before main.bicep (plan A1/A2).
//
// It creates the pipeline's identity and lets GitHub Actions sign in as it, without any password:
//   * a user-assigned managed identity, `id-<baseName>-pipeline` (free);
//   * a federated credential: only workflow jobs of this repository that run in the GitHub environment `production`
//     (which has you as required reviewer) can get a token for it;
//   * Contributor on this resource group, and nothing outside it.
// The identity also becomes the Entra administrator of the SQL server (main.bicep), so it can apply migrations.
//
// Kept apart from main.bicep on purpose: creating a role assignment needs Owner rights, which the pipeline does not
// have, so the pipeline could not re-run a template that contains one.
//
//   az deployment group create -g rg-bookcart -f infra/bootstrap.bicep -p githubRepository=<owner>/BookCartApp

targetScope = 'resourceGroup'

param baseName string = 'bookcart'
param location string = resourceGroup().location

@description('owner/name of the GitHub repository, e.g. octocat/BookCartApp.')
param githubRepository string

@description('The GitHub environment whose jobs may sign in as the pipeline identity.')
param githubEnvironment string = 'production'

// Built-in role "Contributor".
var contributorRoleId = 'b24988ac-6180-42a0-ab88-20f7382dd24c'

resource pipelineIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${baseName}-pipeline'
  location: location
}

resource githubTrust 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: pipelineIdentity
  name: 'github-${githubEnvironment}'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: 'repo:${githubRepository}:environment:${githubEnvironment}'
    audiences: [
      'api://AzureADTokenExchange'
    ]
  }
}

resource pipelineIsContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, pipelineIdentity.id, contributorRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', contributorRoleId)
    principalId: pipelineIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Identifiers for the GitHub variables AZURE_CLIENT_ID (and the tenant and subscription ids from `az account show`).
output pipelineIdentityName string = pipelineIdentity.name
output pipelineClientId string = pipelineIdentity.properties.clientId

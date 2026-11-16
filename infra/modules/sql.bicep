// Azure SQL: a logical server and the free-tier database (plan A1, item 3).
//
// * Microsoft Entra authentication only: no SQL login and no password anywhere. The Entra administrator is the pipeline
//   identity (it applies the migrations, A3). The app identity gets db_datareader and db_datawriter from a script (A3):
//   a database user cannot be created from Bicep.
// * The database uses the FREE TIER: 100,000 vCore-seconds per month, serverless General Purpose (Gen5, 2 vCores),
//   and when the free amount is used up it PAUSES until next month instead of billing. Microsoft: that choice cannot be
//   switched back once "bill overage" is chosen, the free tier is allowed on one database per subscription, and
//   geo-redundant backup storage needs "bill overage", so backups stay locally redundant.
// * Network: the "Allow Azure services" rule lets the web app in (private networking is out of scope, plan section 6);
//   Entra-only authentication is what keeps everyone else out. The pipeline adds a temporary rule for its runner (A3).

param location string
param serverName string

@description('Display name of the Entra administrator (the pipeline identity).')
param adminLogin string

@description('Object (principal) id of the Entra administrator.')
param adminObjectId string

param databaseName string = 'BookDB'

resource server 'Microsoft.Sql/servers@2023-08-01' = {
  name: serverName
  location: location
  properties: {
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    administrators: {
      administratorType: 'ActiveDirectory'
      principalType: 'Application'
      login: adminLogin
      sid: adminObjectId
      tenantId: tenant().tenantId
      azureADOnlyAuthentication: true
    }
  }
}

resource allowAzureServices 'Microsoft.Sql/servers/firewallRules@2023-08-01' = {
  parent: server
  name: 'AllowAllWindowsAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource database 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: server
  name: databaseName
  location: location
  sku: {
    name: 'GP_S_Gen5'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 2
  }
  properties: {
    useFreeLimit: true
    freeLimitExhaustionBehavior: 'AutoPause'
    requestedBackupStorageRedundancy: 'Local'
  }
}

output serverName string = server.name
output serverFqdn string = server.properties.fullyQualifiedDomainName
output databaseName string = database.name

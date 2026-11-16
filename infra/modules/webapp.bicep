// App Service Free F1 (Linux) and the web app running the BookCart container (plan A1, item 2).
//
// Free-tier rules followed here (plan, Part A, "Free-tier limits"):
//   * no Always On and no slots (F1 has neither);
//   * NO health check path: App Service would request it every minute, /health queries the database, and the free
//     database would never pause (its monthly free amount would be gone in days);
//   * covers and keys live in the persistent /home storage (WEBSITES_ENABLE_APP_SERVICE_STORAGE=true; the app creates
//     the folders itself).

param location string
param planName string
param siteName string
param appIdentityId string
param appIdentityClientId string
param containerImage string
param sqlServerFqdn string
param databaseName string

@secure()
param jwtSecret string

@secure()
param geminiApiKey string

param enforceCsp bool

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: planName
  location: location
  kind: 'linux'
  sku: {
    name: 'F1'
    tier: 'Free'
  }
  properties: {
    reserved: true
  }
}

resource site 'Microsoft.Web/sites@2024-04-01' = {
  name: siteName
  location: location
  kind: 'app,linux,container'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${appIdentityId}': {}
    }
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'DOCKER|${containerImage}'
      alwaysOn: false
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
    }
  }
}

// No FTP or SCM publishing passwords: the app is deployed by image only.
resource ftpOff 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-04-01' = {
  parent: site
  name: 'ftp'
  properties: {
    allow: false
  }
}

resource scmOff 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-04-01' = {
  parent: site
  name: 'scm'
  properties: {
    allow: false
  }
  dependsOn: [
    ftpOff
  ]
}

var baseUrl = 'https://${site.properties.defaultHostName}/'

var settings = {
  WEBSITES_PORT: '8080'
  WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'true'
  ASPNETCORE_FORWARDEDHEADERS_ENABLED: 'true'
  ConnectionStrings__DefaultConnection: 'Server=tcp:${sqlServerFqdn},1433;Initial Catalog=${databaseName};Encrypt=True;TrustServerCertificate=False;Connection Timeout=60;Authentication=Active Directory Managed Identity;User Id=${appIdentityClientId}'
  Jwt__SecretKey: jwtSecret
  Jwt__Issuer: baseUrl
  Jwt__Audience: baseUrl
  Storage__UploadFolder: '/home/data/uploads'
  Security__DataProtectionKeysPath: '/home/data/keys'
  Security__EnforceCsp: enforceCsp ? 'true' : 'false'
}

var geminiSettings = empty(geminiApiKey) ? {} : {
  Gemini__ApiKey: geminiApiKey
}

// All settings are owned by this template (this resource replaces the whole list), so a re-run never loses one.
// The configuration resources of one site are written one after the other: parallel writes can conflict.
resource appSettings 'Microsoft.Web/sites/config@2024-04-01' = {
  parent: site
  name: 'appsettings'
  properties: union(settings, geminiSettings)
  dependsOn: [
    scmOff
  ]
}

// Container output for the log stream (az webapp log tail); kept small and short-lived.
resource logs 'Microsoft.Web/sites/config@2024-04-01' = {
  parent: site
  name: 'logs'
  properties: {
    applicationLogs: {
      fileSystem: {
        level: 'Information'
      }
    }
    httpLogs: {
      fileSystem: {
        enabled: true
        retentionInDays: 3
        retentionInMb: 35
      }
    }
    detailedErrorMessages: {
      enabled: false
    }
    failedRequestsTracing: {
      enabled: false
    }
  }
  dependsOn: [
    appSettings
  ]
}

output siteName string = site.name
output hostName string = site.properties.defaultHostName

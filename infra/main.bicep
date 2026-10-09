// Infraestrutura do CompraCerta (NuvemPay) — implantar num grupo de recursos:
//   az deployment group create -g <grupo> -f infra/main.bicep -p @infra/parametros.json

targetScope = 'resourceGroup'

@description('Região dos recursos.')
param localizacao string = resourceGroup().location

@description('Prefixo dos nomes (letras minúsculas, sem espaços).')
@maxLength(11)
param prefixo string = 'compracerta'

@description('Plano do App Service: F1 (gratuito, limitado), B1 (recomendado).')
@allowed(['F1', 'B1', 'B2'])
param skuAppService string = 'B1'

@description('E-mail que recebe os alertas de orçamento.')
param emailAlertas string

@description('Orçamento mensal, na moeda de cobrança da assinatura.')
param valorOrcamento int

@description('Primeiro dia do mês de início do orçamento.')
param inicioOrcamento string = utcNow('yyyy-MM-01T00:00:00Z')

@description('Operadores (Entra ID): [{ "objectId": "...", "papel": "ceo|financeiro|rede|seguranca" }].')
param operadores array = []

@description('Repositório do GitHub autorizado a publicar (dono/nome). Vazio = não criar a identidade de publicação.')
param repositorioGithub string = 'vithorbaron/Compracerta-Marketplace'

@description('Ambiente do GitHub Actions usado na publicação.')
param ambienteGithub string = 'producao'

@description('Senha do banco. Gerada automaticamente e guardada só no Key Vault.')
@secure()
param senhaBanco string = '${newGuid()}${newGuid()}'

var sufixo = uniqueString(resourceGroup().id)
var usuarioBanco = 'ccadmin'
var nomeBanco = 'compracerta'

// Funções nativas do Azure (IDs fixos documentados pela Microsoft).
var papel = {
  leitor: 'acdd72a7-3385-48ef-bd42-f606fba81ae7'
  leitorCustos: '72fafb9e-0641-4937-9268-a91bfd8191a3'
  leitorSeguranca: '39bc4728-0917-49c7-9d2c-d95423bc2eb4'
  leitorLogAnalytics: '73c42c96-874c-492b-b04d-ab87d138a893'
  contribuidorSite: 'de139f84-1756-47ae-9be6-808fbbe84772'
  usuarioSegredosCofre: '4633458b-17de-408a-b874-0445c86b69e6'
  contribuidorBlobs: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
  leitorBlobs: '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'
}

// ---------------------------------------------------------------- monitoramento

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${prefixo}-${sufixo}'
  location: localizacao
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: 1 }
  }
}

// ---------------------------------------------------------------- segredos

resource cofre 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-cc-${take(sufixo, 13)}'
  location: localizacao
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
  }
}

resource segredoBanco 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: cofre
  name: 'senha-banco'
  properties: { value: senhaBanco }
}

// ---------------------------------------------------------------- banco (PostgreSQL)

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: 'psql-${prefixo}-${sufixo}'
  location: localizacao
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '16'
    administratorLogin: usuarioBanco
    administratorLoginPassword: senhaBanco
    storage: { storageSizeGB: 32, autoGrow: 'Disabled' }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
    authConfig: { activeDirectoryAuth: 'Disabled', passwordAuth: 'Enabled' }
  }
}

resource bancoDados 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: nomeBanco
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

// Só serviços do Azure alcançam o banco (o App Service); a senha continua exigida.
resource firewallBanco 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'PermitirServicosAzure'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
  dependsOn: [bancoDados]
}

resource logConexoes 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgres
  name: 'log_connections'
  properties: { value: 'on', source: 'user-override' }
  dependsOn: [firewallBanco]
}

// ---------------------------------------------------------------- imagens (Blob Storage)

resource armazenamento 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'st${take(prefixo, 9)}${take(sufixo, 11)}'
  location: localizacao
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false // nada é público: as fotos são entregues pela aplicação
    allowSharedKeyAccess: false // acesso só com Entra ID: sem chave de conta e sem SAS assinado por ela
    defaultToOAuthAuthentication: true
    publicNetworkAccess: 'Enabled'
  }
}

resource servicoBlob 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: armazenamento
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 7 }
  }
}

resource containerProdutos 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: servicoBlob
  name: 'produtos'
  properties: { publicAccess: 'None' }
}

// ---------------------------------------------------------------- aplicação (App Service)

resource plano 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'asp-${prefixo}-${sufixo}'
  location: localizacao
  sku: { name: skuAppService }
  kind: 'linux'
  properties: { reserved: true }
}

resource site 'Microsoft.Web/sites@2023-12-01' = {
  name: 'app-${prefixo}-${sufixo}'
  location: localizacao
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plano.id
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'PYTHON|3.12'
      appCommandLine: 'python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2 --no-server-header'
      alwaysOn: skuAppService != 'F1'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      http20Enabled: true
      remoteDebuggingEnabled: false
      healthCheckPath: '/api/saude'
    }
  }
}

// Publicação só com identidade do Entra ID (sem usuário/senha de FTP ou SCM).
resource semFtp 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: site
  name: 'ftp'
  properties: { allow: false }
}

resource semScm 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: site
  name: 'scm'
  properties: { allow: false }
}

resource siteLeSegredos 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: cofre
  name: guid(cofre.id, site.id, papel.usuarioSegredosCofre)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', papel.usuarioSegredosCofre)
    principalId: site.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// O site só lê as fotos, e só no container de imagens.
resource siteLeImagens 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: containerProdutos
  name: guid(containerProdutos.id, site.id, papel.leitorBlobs)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', papel.leitorBlobs)
    principalId: site.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource configuracoesSite 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: site
  name: 'appsettings'
  properties: {
    SCM_DO_BUILD_DURING_DEPLOYMENT: 'true'
    PGHOST: postgres.properties.fullyQualifiedDomainName
    PGDATABASE: nomeBanco
    PGUSER: usuarioBanco
    PGSSLMODE: 'require'
    PGPASSWORD: '@Microsoft.KeyVault(SecretUri=${segredoBanco.properties.secretUriWithVersion})'
    IMAGENS_BLOB_URL: '${armazenamento.properties.primaryEndpoints.blob}${containerProdutos.name}'
    ORIGENS_PERMITIDAS: 'https://${site.properties.defaultHostName}'
    TRUST_PROXY: '1'
    COOKIE_SEGURO: '1'
    PAPEIS_OPERADORES: ''
  }
  dependsOn: [siteLeSegredos, siteLeImagens, bancoDados, firewallBanco]
}

// ---------------------------------------------------------------- logs para o Log Analytics

resource diagSite 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: site
  name: 'para-log-analytics'
  properties: {
    workspaceId: logs.id
    logs: [
      { category: 'AppServiceHTTPLogs', enabled: true }
      { category: 'AppServiceConsoleLogs', enabled: true }
      { category: 'AppServiceAppLogs', enabled: true }
      { category: 'AppServicePlatformLogs', enabled: true }
    ]
  }
}

resource diagBanco 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: postgres
  name: 'para-log-analytics'
  properties: {
    workspaceId: logs.id
    logs: [{ category: 'PostgreSQLLogs', enabled: true }]
  }
}

resource diagCofre 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: cofre
  name: 'para-log-analytics'
  properties: {
    workspaceId: logs.id
    logs: [{ category: 'AuditEvent', enabled: true }]
  }
}

resource diagBlob 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: servicoBlob
  name: 'para-log-analytics'
  properties: {
    workspaceId: logs.id
    logs: [
      { category: 'StorageRead', enabled: true }
      { category: 'StorageWrite', enabled: true }
      { category: 'StorageDelete', enabled: true }
    ]
  }
}

// ---------------------------------------------------------------- publicação pelo GitHub Actions
// Identidade gerenciada com credencial federada (OIDC): o GitHub entra no Azure
// sem senha guardada, e só pode publicar o site e enviar imagens.

resource identidadeGithub 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (!empty(repositorioGithub)) {
  name: 'id-github-${prefixo}-${sufixo}'
  location: localizacao
}

resource credencialGithub 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = if (!empty(repositorioGithub)) {
  parent: identidadeGithub
  name: 'github-${ambienteGithub}'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: 'repo:${repositorioGithub}:environment:${ambienteGithub}'
    audiences: ['api://AzureADTokenExchange']
  }
}

resource githubPublicaSite 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(repositorioGithub)) {
  scope: site
  name: guid(site.id, 'github', papel.contribuidorSite)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', papel.contribuidorSite)
    principalId: identidadeGithub!.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Só no container de imagens, não na conta de storage inteira.
resource githubEnviaImagens 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(repositorioGithub)) {
  scope: containerProdutos
  name: guid(containerProdutos.id, 'github', papel.contribuidorBlobs)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', papel.contribuidorBlobs)
    principalId: identidadeGithub!.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------- operadores (Entra ID + RBAC)

var papeisNoGrupo = {
  ceo: [papel.leitor, papel.leitorCustos]
  financeiro: [papel.leitor, papel.leitorCustos]
  rede: [papel.leitor]
  seguranca: [papel.leitor, papel.leitorSeguranca]
}

var atribuicoesNoGrupo = flatten(map(operadores, op => map(papeisNoGrupo[op.papel], r => {
  principalId: op.objectId
  funcao: r
})))

resource rbacGrupo 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for a in atribuicoesNoGrupo: {
  name: guid(resourceGroup().id, a.principalId, a.funcao)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', a.funcao)
    principalId: a.principalId
    principalType: 'User'
  }
}]

// Rede administra o App Service (domínio, TLS, restrições de acesso).
resource rbacRede 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for op in filter(operadores, o => o.papel == 'rede'): {
  scope: site
  name: guid(site.id, op.objectId, papel.contribuidorSite)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', papel.contribuidorSite)
    principalId: op.objectId
    principalType: 'User'
  }
}]

// Segurança consulta os logs centralizados.
resource rbacSeguranca 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for op in filter(operadores, o => o.papel == 'seguranca'): {
  scope: logs
  name: guid(logs.id, op.objectId, papel.leitorLogAnalytics)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', papel.leitorLogAnalytics)
    principalId: op.objectId
    principalType: 'User'
  }
}]

// ---------------------------------------------------------------- custo

resource orcamento 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: 'orcamento-${prefixo}'
  properties: {
    category: 'Cost'
    amount: valorOrcamento
    timeGrain: 'Monthly'
    timePeriod: { startDate: inicioOrcamento }
    notifications: {
      real50: { enabled: true, operator: 'GreaterThan', threshold: 50, thresholdType: 'Actual', contactEmails: [emailAlertas] }
      real80: { enabled: true, operator: 'GreaterThan', threshold: 80, thresholdType: 'Actual', contactEmails: [emailAlertas] }
      previsto100: { enabled: true, operator: 'GreaterThan', threshold: 100, thresholdType: 'Forecasted', contactEmails: [emailAlertas] }
    }
  }
}

// ---------------------------------------------------------------- saídas

output nomeSite string = site.name
output nomePlano string = plano.name
output enderecoSite string = 'https://${site.properties.defaultHostName}'
output nomeArmazenamento string = armazenamento.name
output enderecoImagens string = 'https://${site.properties.defaultHostName}/imagens'
output servidorBanco string = postgres.properties.fullyQualifiedDomainName
output nomeCofre string = cofre.name
output nomeLogAnalytics string = logs.name
output githubAzureClientId string = empty(repositorioGithub) ? '' : identidadeGithub!.properties.clientId
output githubAzureTenantId string = subscription().tenantId
output githubAzureSubscriptionId string = subscription().subscriptionId

// A monthly cost budget on the resource group (plan A1, item 4; free). The expected cost is zero, so any alert means a
// paid resource or setting slipped in. A budget only warns; it never stops anything.

param name string

@description('Monthly amount in the billing currency.')
param amount int

@description('yyyy-MM-01, the current month or later when created; must not change afterwards.')
param startDate string

param contactEmails array

var notify = {
  enabled: true
  operator: 'GreaterThan'
  contactEmails: contactEmails
}

resource budget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: name
  properties: {
    category: 'Cost'
    amount: amount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: startDate
    }
    notifications: {
      actual50: union(notify, {
        threshold: 50
        thresholdType: 'Actual'
      })
      actual100: union(notify, {
        threshold: 100
        thresholdType: 'Actual'
      })
      forecast100: union(notify, {
        threshold: 100
        thresholdType: 'Forecasted'
      })
    }
  }
}

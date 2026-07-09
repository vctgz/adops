import { describe, expect, it } from 'vitest'
import { buildChangesQuery, mapChangeRows } from '../src/commands/changes.js'

describe('buildChangesQuery', () => {
  it('always includes a LIMIT (mandatory for change_event) and orders newest first', () => {
    const q = buildChangesQuery('7d')
    expect(q).toContain('FROM change_event')
    expect(q).toMatch(/LIMIT \d+/)
    expect(q).toContain('ORDER BY change_event.change_date_time DESC')
    expect(q).toContain('DURING LAST_7_DAYS')
  })

  it('adds a user filter when given', () => {
    expect(buildChangesQuery('30d', 'jane@x.com')).toContain("change_event.user_email = 'jane@x.com'")
  })

  it('maps preset aliases and rejects unknowns', () => {
    expect(buildChangesQuery('today')).toContain('DURING TODAY')
    expect(() => buildChangesQuery('90d')).toThrowError(/30 days max/)
  })
})

describe('mapChangeRows', () => {
  it('shortens resource types + client and joins changed fields', () => {
    const rows = mapChangeRows([{
      'changeEvent.changeDateTime': '2026-07-19 08:31:00+00:00',
      'changeEvent.userEmail': 'jane@x.com',
      'changeEvent.clientType': 'GOOGLE_ADS_WEB_CLIENT',
      'changeEvent.changeResourceType': 'AD_GROUP_CRITERION',
      'changeEvent.resourceChangeOperation': 'UPDATE',
      'changeEvent.changedFields': 'status,cpc_bid_micros',
    }])
    expect(rows[0]).toEqual({
      when: '2026-07-19 08:31:00',
      user: 'jane@x.com',
      op: 'UPDATE',
      resource: 'keyword',
      fields: 'status,cpc_bid_micros',
      client: 'web_client',
    })
  })

  it('handles changed_fields arriving as an array', () => {
    const rows = mapChangeRows([{ 'changeEvent.changeResourceType': 'CAMPAIGN', 'changeEvent.changedFields': ['name', 'status'] }])
    expect(rows[0].fields).toBe('name, status')
    expect(rows[0].resource).toBe('campaign')
  })
})

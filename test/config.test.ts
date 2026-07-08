import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { googleCustomerId, metaAdAccount, resolveProfile } from '../src/core/config.js'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'adops-cfg-'))
  process.env.ADOPS_CONFIG_DIR = dir
  delete process.env.ADOPS_PROFILE
})
afterEach(() => {
  delete process.env.ADOPS_CONFIG_DIR
  delete process.env.ADOPS_PROFILE
})

const CONFIG = `
default_profile = "acme"

[profiles.acme]
google_customer_id = "123-456-7890"
meta_ad_account = "act_111"

[profiles.acme.budgets]
google = 50000
meta = 80000

[profiles.other]
meta_ad_account = "222"
`

describe('resolveProfile', () => {
  it('uses default_profile', () => {
    writeFileSync(join(dir, 'config.toml'), CONFIG)
    const rp = resolveProfile()
    expect(rp.name).toBe('acme')
    expect(rp.profile.budgets?.google).toBe(50000)
  })

  it('explicit name and ADOPS_PROFILE override the default', () => {
    writeFileSync(join(dir, 'config.toml'), CONFIG)
    expect(resolveProfile('other').name).toBe('other')
    process.env.ADOPS_PROFILE = 'other'
    expect(resolveProfile().name).toBe('other')
  })

  it('throws on unknown profiles, works env-only with no config file', () => {
    writeFileSync(join(dir, 'config.toml'), CONFIG)
    expect(() => resolveProfile('nope')).toThrowError(/not found/)
    process.env.ADOPS_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'adops-empty-'))
    expect(resolveProfile().name).toBe('default')
  })
})

describe('id accessors', () => {
  it('strips dashes from google customer ids and prefixes meta act_', () => {
    writeFileSync(join(dir, 'config.toml'), CONFIG)
    const { profile } = resolveProfile('acme')
    expect(googleCustomerId(profile)).toBe('1234567890')
    expect(metaAdAccount(profile)).toBe('act_111')
    expect(metaAdAccount(resolveProfile('other').profile)).toBe('act_222')
  })

  it('errors clearly when unset', () => {
    process.env.ADOPS_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'adops-empty2-'))
    const { profile } = resolveProfile()
    expect(() => googleCustomerId(profile)).toThrowError(/google_customer_id/)
  })
})

import { expect, it } from 'vitest'
import { resolve } from 'node:path'
import { resolveStorageDirectory, resolveStorageDirectories } from '../docker-entrypoint.mjs'

it('permits only one owned metadata subdirectory inside the configured volume', () => {
  expect(resolveStorageDirectory('/data/vanity-assets', '/data')).toContain('vanity-assets')
  expect(() => resolveStorageDirectory('/etc', '/data')).toThrow()
  expect(() => resolveStorageDirectory('/data', '/data')).toThrow()
  expect(() => resolveStorageDirectory('/data/../etc', '/data')).toThrow()
  expect(() => resolveStorageDirectory('/anything', '/')).toThrow()
})

it('prepares separate public assets and private X credentials without accepting directory reuse', () => {
  expect(resolveStorageDirectories({ RAILWAY_VOLUME_MOUNT_PATH: '/data', ASSET_STORAGE_DIR: '/data/vanity-assets', X_STORAGE_DIR: '/data/vanity-x' })).toEqual([
    resolve('/data/vanity-assets'), resolve('/data/vanity-x'),
  ])
  expect(resolveStorageDirectories({ RAILWAY_VOLUME_MOUNT_PATH: '/data', X_STORAGE_DIR: '/data/vanity-x' })).toEqual([resolve('/data/vanity-x')])
  expect(() => resolveStorageDirectories({ RAILWAY_VOLUME_MOUNT_PATH: '/data', ASSET_STORAGE_DIR: '/data/vanity-assets', X_STORAGE_DIR: '/data/vanity-assets' })).toThrow()
  expect(() => resolveStorageDirectories({ RAILWAY_VOLUME_MOUNT_PATH: '/data', X_STORAGE_DIR: '/data/vanity-assets/private' })).toThrow()
})

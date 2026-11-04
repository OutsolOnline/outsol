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

it('prepares separate private funding, indexing and automation directories', () => {
  const environment = { RAILWAY_VOLUME_MOUNT_PATH: '/data', ASSET_STORAGE_DIR: '/data/assets', X_STORAGE_DIR: '/data/x', FUNDING_STORAGE_DIR: '/data/funding', BACKGROUND_JOBS_STORAGE_DIR: '/data/history', AUTOMATION_STORAGE_DIR: '/data/automation' }
  expect(resolveStorageDirectories(environment)).toEqual(['assets','x','funding','history','automation'].map(name=>resolve('/data',name)))
  expect(()=>resolveStorageDirectories({...environment,BACKGROUND_JOBS_STORAGE_DIR:environment.FUNDING_STORAGE_DIR})).toThrow()
  expect(()=>resolveStorageDirectories({...environment,AUTOMATION_STORAGE_DIR:environment.ASSET_STORAGE_DIR})).toThrow()
  expect(()=>resolveStorageDirectories({...environment,FUNDING_STORAGE_DIR:'/data/other/nested'})).toThrow()
})

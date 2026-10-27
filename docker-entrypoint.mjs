import { mkdir, chmod, chown, lstat, realpath } from 'node:fs/promises'
import { resolve, dirname, parse } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Restrict privileged setup to direct children of the configured volume. */
export function resolveStorageDirectory(storageDirectory, volumeDirectory) {
  const volume = resolve(volumeDirectory)
  const storage = resolve(storageDirectory)
  if (volume === parse(volume).root || dirname(storage) !== volume || storage === volume) {
    throw new Error('Storage must be a direct subdirectory of the mounted volume')
  }
  return storage
}

export function resolveStorageDirectories(environment) {
  const volume = environment.RAILWAY_VOLUME_MOUNT_PATH || '/data'
  const directories = [environment.ASSET_STORAGE_DIR, environment.X_STORAGE_DIR].filter(Boolean).map(value => resolveStorageDirectory(value, volume))
  if (new Set(directories).size !== directories.length) throw new Error('Public assets and private X credentials require separate directories')
  return directories
}

async function start() {
  if (process.getuid?.() === 0) {
    const directories = resolveStorageDirectories(process.env)
    if (directories.length) {
      const volume = resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data')
      await mkdir(volume, { recursive: true })
      if ((await lstat(volume)).isSymbolicLink()) throw new Error('Volume mount cannot be a symbolic link')
      for (const directory of directories) {
        await mkdir(directory, { recursive: true, mode: 0o700 })
        const stat = await lstat(directory)
        if (!stat.isDirectory() || stat.isSymbolicLink() || dirname(await realpath(directory)) !== await realpath(volume)) throw new Error('Invalid application storage directory')
        // Existing files need no ownership changes. Never recurse through a volume.
        await chmod(directory, 0o700)
        await chown(directory, 1001, 1001)
      }
    }
    process.setgroups([])
    process.setgid(1001)
    process.setuid(1001)
  }
  await import('./server.js')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  start().catch(() => { console.error('Application startup failed. Check application volume configuration and permissions.'); process.exitCode = 1 })
}

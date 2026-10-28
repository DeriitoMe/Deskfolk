#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const bundleName = 'deskfolk-deepseek-harness'
const ownDirectory = path.dirname(fileURLToPath(import.meta.url))

export const help = `Deskfolk × DeepSeek Harness

Install into an existing, explicitly selected Harness profile:
  node setup.mjs --profile web --dry-run
  node setup.mjs --profile web
  node setup.mjs --profile desktop

Options:
  --profile <name>       Existing Harness profile; no profile is guessed.
  --profile-dir <path>   Existing <DSH_HOME>/profiles/<name> directory.
  --dsh-home <path>      Harness home (otherwise DSH_HOME or ~/.dsh).
  --dsh-command <path>   Harness dsh executable or launcher (default: dsh).
  --uninstall           Remove this bundle through Harness plugin management.
  --dry-run             Show the target and exact argument array; change nothing.
  --help                Show this help.

Desktop: initialize Desktop once, fully quit it, then use the dsh command
registered by Desktop's “Manage dsh Command…” menu. Reopen after installation.
`

function requireValue(argv, index) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${argv[index]} requires a value`)
  if (/[\0\r\n]/u.test(value)) throw new Error(`${argv[index]} contains an unsupported control character`)
  return value
}

export function createSetupPlan(argv, options = {}) {
  const env = options.env ?? process.env
  const pluginDirectory = path.resolve(options.pluginDirectory ?? ownDirectory)
  const homeDirectory = options.homeDirectory ?? homedir()
  const values = {}
  const flags = new Set()
  const valueOptions = new Set(['--profile', '--profile-dir', '--dsh-home', '--dsh-command'])
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (valueOptions.has(argument)) {
      if (values[argument] !== undefined) throw new Error(`${argument} was supplied more than once`)
      values[argument] = requireValue(argv, index)
      index += 1
    } else if (['--uninstall', '--dry-run', '--help'].includes(argument)) {
      flags.add(argument)
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  if (flags.has('--help')) return { help: true }

  let profile = values['--profile']
  let dshHome = path.resolve(values['--dsh-home'] ?? env.DSH_HOME ?? path.join(homeDirectory, '.dsh'))
  let profileDirectory
  if (values['--profile-dir']) {
    profileDirectory = path.resolve(values['--profile-dir'])
    const profilesDirectory = path.dirname(profileDirectory)
    if (path.basename(profilesDirectory) !== 'profiles') {
      throw new Error('--profile-dir must identify <DSH_HOME>/profiles/<name>')
    }
    const derivedProfile = path.basename(profileDirectory)
    const derivedHome = path.dirname(profilesDirectory)
    if (profile && profile !== derivedProfile) throw new Error('--profile and --profile-dir select different profiles')
    if (values['--dsh-home'] && dshHome !== derivedHome) throw new Error('--dsh-home and --profile-dir select different homes')
    profile = derivedProfile
    dshHome = derivedHome
  }
  if (!profile) throw new Error('Select an existing Harness profile with --profile or --profile-dir')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u.test(profile)) throw new Error('Invalid Harness profile name')
  profileDirectory ??= path.join(dshHome, 'profiles', profile)
  const uninstall = flags.has('--uninstall')
  return {
    operation: uninstall ? 'uninstall' : 'install',
    dryRun: flags.has('--dry-run'),
    profile,
    profileDirectory,
    dshHome,
    pluginDirectory,
    command: values['--dsh-command'] ?? 'dsh',
    args: ['plugin', '--profile', profile, uninstall ? 'remove' : 'add', uninstall ? bundleName : `file:${pluginDirectory}`],
  }
}

export function inspectSetupTarget(plan) {
  const manifestPath = path.join(plan.profileDirectory, 'package.json')
  if (!existsSync(manifestPath)) {
    throw new Error('The selected Harness profile is not initialized. Open the intended Harness application once before installing.')
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    throw new Error('The selected profile package.json is not valid JSON')
  }
  const bundles = manifest?.dsh?.profile?.bundles
  if (!Array.isArray(bundles) || !bundles.every(bundle => typeof bundle === 'string')) {
    throw new Error('The selected directory does not contain a Harness profile manifest')
  }
  if (plan.operation === 'install') {
    for (const file of ['package.json', 'cordis.patch.yml', 'plugin.mjs', 'bridge-client.mjs']) {
      if (!existsSync(path.join(plan.pluginDirectory, file))) throw new Error(`Plugin bundle is incomplete: ${file}`)
    }
  }
  return { installed: bundles.includes(bundleName) }
}

export function resolveCommand(command, env = process.env, platform = process.platform) {
  if (platform !== 'win32') return command
  const extension = path.extname(command)
  // npm also writes an extensionless POSIX shell shim. Prefer Windows launchers
  // so CreateProcess does not try to execute that shim and report ENOENT.
  const extensions = extension ? [''] : [...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean), '']
  const directories = /[\\/]/u.test(command) ? [''] : (env.PATH ?? env.Path ?? '').split(path.delimiter)
  for (const directory of directories) {
    for (const suffix of extensions) {
      const candidate = directory ? path.join(directory.replace(/^"|"$/gu, ''), `${command}${suffix}`) : `${command}${suffix}`
      try {
        if (statSync(candidate).isFile()) return path.resolve(candidate)
      } catch { /* Continue searching only command paths; never inspect private Harness files. */ }
    }
  }
  return command
}

// Windows batch launchers require cmd.exe. Quote every argument, turn delayed
// expansion off, and reject characters cmd would expand even inside quotes.
export function quoteCmdArgument(value) {
  if (/[%"\0\r\n]/u.test(value)) throw new Error('The Windows dsh launcher cannot safely receive percent, quote, or control characters; use an executable launcher or a directory without those characters')
  return `"${value}"`
}

export function createInvocation(plan, options = {}) {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const command = resolveCommand(plan.command, env, platform)
  if (platform === 'win32' && /\.(?:cmd|bat)$/iu.test(command)) {
    const commandLine = [command, ...plan.args].map(quoteCmdArgument).join(' ')
    return {
      command: env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/v:off', '/s', '/c', `"${commandLine}"`],
      windowsVerbatimArguments: true,
    }
  }
  return { command, args: [...plan.args] }
}

export function runSetup(plan, options = {}) {
  const io = options.io ?? console
  const env = { ...(options.env ?? process.env), DSH_HOME: plan.dshHome }
  inspectSetupTarget(plan)
  io.log(`Harness profile: ${plan.profile}`)
  io.log(`Profile directory: ${plan.profileDirectory}`)
  io.log(`Operation: ${plan.operation}`)
  io.log(`Command: ${plan.command}`)
  io.log(`Arguments: ${JSON.stringify(plan.args)}`)
  if (plan.dryRun) {
    io.log('Dry run: no command was executed and no configuration was changed.')
    return 0
  }
  const invocation = createInvocation(plan, { env, platform: options.platform })
  const result = (options.spawn ?? spawnSync)(invocation.command, invocation.args, {
    env,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    ...(invocation.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
  })
  if (result.error) {
    if (result.error.code === 'ENOENT') throw new Error('The dsh command was not found. Register it in Harness Desktop via “Manage dsh Command…” or supply --dsh-command.')
    throw new Error(`Harness plugin management could not start (${result.error.code ?? 'unknown error'})`)
  }
  if (result.status !== 0) throw new Error(`Harness plugin management failed (${result.signal ?? result.status ?? 'unknown exit'})`)
  io.log(plan.operation === 'install'
    ? 'Deskfolk bundle installed. Restart the selected Harness application to activate it.'
    : 'Deskfolk bundle removed. Restart the selected Harness application to unload it.')
  return 0
}

// Node resolves the entry module through junctions and symlinks (e.g. a moved
// AppData folder) but leaves argv[1] as typed, so compare real paths.
function isMain() {
  try { return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url } catch { return false }
}
if (isMain()) {
  try {
    const plan = createSetupPlan(process.argv.slice(2))
    if (plan.help) console.log(help)
    else process.exitCode = runSetup(plan)
  } catch (error) {
    console.error(`Deskfolk Harness setup: ${error.message}`)
    process.exitCode = 1
  }
}

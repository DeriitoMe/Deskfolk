import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createSetupPlan, inspectSetupTarget, runSetup, createInvocation, quoteCmdArgument } from './setup.mjs'

const quiet = { log() {} }

function fixture(t, suffix = '') {
  const temporaryDirectory = path.resolve(tmpdir())
  const root = mkdtempSync(path.join(temporaryDirectory, 'deskfolk-harness-setup-'))
  if (path.dirname(root) !== temporaryDirectory || !path.basename(root).startsWith('deskfolk-harness-setup-')) throw new Error('Unexpected fixture cleanup target')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dshHome = path.join(root, 'Harness home')
  const profileDirectory = path.join(dshHome, 'profiles', 'web')
  const pluginDirectory = path.join(root, `Deskfolk 插件${suffix}`)
  mkdirSync(profileDirectory, { recursive: true })
  mkdirSync(pluginDirectory, { recursive: true })
  const manifest = '{\r\n  "private": true, "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } }\r\n}\r\n'
  const patch = '# Existing custom setup\r\n- id: custom\r\n  config:\r\n    enabled: true\r\n'
  writeFileSync(path.join(profileDirectory, 'package.json'), manifest)
  writeFileSync(path.join(profileDirectory, 'cordis.patch.yml'), patch)
  for (const name of ['package.json', 'cordis.patch.yml', 'plugin.mjs', 'bridge-client.mjs']) writeFileSync(path.join(pluginDirectory, name), '')
  return { root, dshHome, profileDirectory, pluginDirectory, manifest, patch }
}

test('requires an explicit profile and rejects traversal or ambiguous arguments', () => {
  assert.throws(() => createSetupPlan([]), /Select an existing Harness profile/u)
  assert.throws(() => createSetupPlan(['--profile', '../desktop']), /Invalid Harness profile/u)
  assert.throws(() => createSetupPlan(['--profile', '--dry-run']), /requires a value/u)
  assert.throws(() => createSetupPlan(['--profile', 'web', '--profile', 'desktop']), /more than once/u)
  assert.throws(() => createSetupPlan(['--profile', 'web', '--unknown']), /Unknown argument/u)
  assert.deepEqual(createSetupPlan(['--help']), { help: true })
})

test('selects DSH_HOME and derives a profile without ignoring conflicting explicit options', t => {
  const f = fixture(t)
  const plan = createSetupPlan(['--profile', 'web'], { env: { DSH_HOME: f.dshHome }, pluginDirectory: f.pluginDirectory })
  assert.equal(plan.profileDirectory, f.profileDirectory)
  assert.equal(plan.dshHome, f.dshHome)
  const derived = createSetupPlan(['--profile-dir', f.profileDirectory], { env: { DSH_HOME: path.join(f.root, 'another home') } })
  assert.equal(derived.profile, 'web')
  assert.equal(derived.dshHome, f.dshHome)
  assert.throws(() => createSetupPlan(['--profile', 'desktop', '--profile-dir', f.profileDirectory]), /different profiles/u)
  assert.throws(() => createSetupPlan(['--dsh-home', f.root, '--profile-dir', f.profileDirectory]), /different homes/u)
  assert.throws(() => createSetupPlan(['--profile-dir', f.root]), /profiles/u)
})

test('requires an initialized profile and complete plugin before executing anything', t => {
  const f = fixture(t)
  const options = { env: { DSH_HOME: f.dshHome }, pluginDirectory: f.pluginDirectory }
  const plan = createSetupPlan(['--profile', 'web'], options)
  assert.deepEqual(inspectSetupTarget(plan), { installed: false })
  rmSync(path.join(f.pluginDirectory, 'plugin.mjs'))
  assert.throws(() => inspectSetupTarget(plan), /incomplete: plugin.mjs/u)
  const missing = createSetupPlan(['--profile', 'desktop'], options)
  assert.throws(() => inspectSetupTarget(missing), /not initialized/u)
  writeFileSync(path.join(f.profileDirectory, 'package.json'), '{}')
  assert.throws(() => inspectSetupTarget(plan), /does not contain a Harness profile/u)
})

test('dry-run preserves existing configuration byte for byte and never starts dsh', t => {
  const f = fixture(t)
  const plan = createSetupPlan(['--profile-dir', f.profileDirectory, '--dry-run'], { pluginDirectory: f.pluginDirectory })
  let spawned = false
  assert.equal(runSetup(plan, { io: quiet, spawn() { spawned = true } }), 0)
  assert.equal(spawned, false)
  assert.equal(readFileSync(path.join(f.profileDirectory, 'package.json'), 'utf8'), f.manifest)
  assert.equal(readFileSync(path.join(f.profileDirectory, 'cordis.patch.yml'), 'utf8'), f.patch)
})

test('delegates install and uninstall to official plugin manager with literal argument arrays', t => {
  const f = fixture(t)
  const env = { DSH_HOME: f.dshHome, TEST_MARKER: 'retained' }
  const calls = []
  const spawn = (command, args, options) => { calls.push({ command, args, options }); return { status: 0 } }
  const plan = createSetupPlan(['--profile', 'web', '--dsh-command', 'test-dsh'], { env, pluginDirectory: f.pluginDirectory })
  runSetup(plan, { env, spawn, io: quiet, platform: 'linux' })
  assert.equal(calls[0].command, 'test-dsh')
  assert.deepEqual(calls[0].args, ['plugin', '--profile', 'web', 'add', `file:${f.pluginDirectory}`])
  assert.equal(calls[0].options.shell, false)
  assert.equal(calls[0].options.env.DSH_HOME, f.dshHome)
  assert.equal(calls[0].options.env.TEST_MARKER, 'retained')
  const uninstall = createSetupPlan(['--profile', 'web', '--uninstall'], { env, pluginDirectory: 'missing package directory' })
  runSetup(uninstall, { env, spawn, io: quiet, platform: 'linux' })
  assert.deepEqual(calls[1].args, ['plugin', '--profile', 'web', 'remove', 'deskfolk-deepseek-harness'])
  assert.equal(readFileSync(path.join(f.profileDirectory, 'cordis.patch.yml'), 'utf8'), f.patch)
})

test('reports missing launcher and failed plugin transaction without exposing raw error contents', t => {
  const f = fixture(t)
  const plan = createSetupPlan(['--profile-dir', f.profileDirectory], { pluginDirectory: f.pluginDirectory })
  assert.throws(() => runSetup(plan, { io: quiet, spawn: () => ({ error: Object.assign(new Error('private details'), { code: 'ENOENT' }) }) }), /command was not found/u)
  assert.throws(() => runSetup(plan, { io: quiet, spawn: () => ({ status: 4 }) }), /failed \(4\)/u)
})

test('quotes Windows batch arguments and rejects text expanded even inside quotes', () => {
  assert.equal(quoteCmdArgument('a & b!'), '"a & b!"')
  for (const value of ['%PATH%', 'a"b', 'a\nb', 'a\0b']) assert.throws(() => quoteCmdArgument(value), /cannot safely receive/u)
  const invocation = createInvocation({ command: 'dsh.cmd', args: ['plugin', '--profile', 'web', 'add', 'file:C:\\Space & Folder'] }, { platform: 'win32', env: { PATH: '', ComSpec: 'cmd.exe' } })
  assert.equal(invocation.command, 'cmd.exe')
  assert.deepEqual(invocation.args.slice(0, 4), ['/d', '/v:off', '/s', '/c'])
  assert.equal(invocation.windowsVerbatimArguments, true)
  assert.equal(invocation.args[4], '""dsh.cmd" "plugin" "--profile" "web" "add" "file:C:\\Space & Folder""')
})

test('Windows .cmd launcher preserves spaces, Unicode, and shell metacharacters as argument data', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t, ' & dollar$ apostrophe\' bang!')
  const capture = path.join(f.root, 'captured.json')
  const captureScript = path.join(f.root, 'capture.mjs')
  const launcher = path.join(f.root, 'test dsh & launcher.cmd')
  writeFileSync(captureScript, "import {writeFileSync} from 'node:fs'; writeFileSync(process.env.DESKFOLK_SETUP_CAPTURE, JSON.stringify(process.argv.slice(2)));\n")
  writeFileSync(launcher, `@echo off\r\n"${process.execPath}" "${captureScript}" %*\r\n`)
  const plan = createSetupPlan(['--profile-dir', f.profileDirectory, '--dsh-command', launcher], { pluginDirectory: f.pluginDirectory })
  runSetup(plan, { io: quiet, env: { ...process.env, DESKFOLK_SETUP_CAPTURE: capture } })
  assert.deepEqual(JSON.parse(readFileSync(capture, 'utf8')), plan.args)
})

test('the files the installer ships run from an install path with spaces, CJK and a junction', t => {
  const f = fixture(t)
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const shipped = pkg.build.extraResources.find(entry => entry.to === 'plugins/deskfolk-deepseek-harness')
  assert.ok(shipped, 'package.json ships the DeepSeek Harness plugin')
  const programs = path.join(f.root, 'Programs 桌宠')
  const relative = path.join('Liquid Glass Pet', 'resources', 'plugins', 'deskfolk-deepseek-harness')
  const plugin = path.join(programs, relative)
  mkdirSync(plugin, { recursive: true })
  for (const name of shipped.filter) copyFileSync(fileURLToPath(new URL(name, import.meta.url)), path.join(plugin, name))
  const linked = path.join(f.root, 'Linked Programs')
  symlinkSync(programs, linked, 'junction')
  const expected = ['plugin', '--profile', 'web', 'add', `file:${realpathSync(plugin)}`]
  const dryRun = (args, options) => {
    const result = spawnSync(process.execPath, [...args, '--profile-dir', f.profileDirectory, '--dry-run'], { encoding: 'utf8', timeout: 15_000, ...options })
    assert.equal(result.status, 0, result.stderr)
    const line = result.stdout.split(/\r?\n/u).find(text => text.startsWith('Arguments: '))
    assert.ok(line, 'setup ran instead of silently exiting')
    return JSON.parse(line.slice('Arguments: '.length))
  }
  // As the README says: run setup.mjs from the installed plugin folder, or by full path.
  assert.deepEqual(dryRun(['setup.mjs'], { cwd: plugin }), expected)
  // Through a junction (e.g. a relocated AppData) setup still runs and passes the real path.
  assert.deepEqual(dryRun([path.join(linked, relative, 'setup.mjs')]), expected)
})

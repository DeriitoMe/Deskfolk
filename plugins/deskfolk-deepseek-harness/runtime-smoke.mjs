#!/usr/bin/env node
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as deskfolk from './plugin.mjs'

const versions = {
  '@deepseek-ai/cordis': '4.0.5',
  '@deepseek-ai/dsh-session': '0.2.1-rc.2',
  '@deepseek-ai/dsh-session-projection': '0.2.1-rc.2',
}

const help = `Exercise Deskfolk with the real, pinned Harness runtime in an isolated fixture.

  node plugins/deskfolk-deepseek-harness/runtime-smoke.mjs --runtime-dir .cache/harness-runtime-smoke

The directory must contain the runtime's package.json and node_modules.
No Harness application, user profile, API key or model request is used.
`

export async function runRuntimeSmoke(runtimeDirectory) {
  const runtimeRoot = path.resolve(runtimeDirectory)
  const require = createRequire(path.join(runtimeRoot, 'package.json'))
  const modules = {}
  for (const [name, version] of Object.entries(versions)) {
    try {
      const manifest = await import(pathToFileURL(require.resolve(`${name}/package.json`)).href, { with: { type: 'json' } })
      assert.equal(manifest.default.version, version, `Expected pinned ${name}@${version}`)
      modules[name] = await import(pathToFileURL(require.resolve(name)).href)
    } catch (error) {
      throw new Error(`Cannot load ${name}@${version} from --runtime-dir: ${error.message}`)
    }
  }
  const { Context } = modules['@deepseek-ai/cordis']
  const { default: SessionStore } = modules['@deepseek-ai/dsh-session']
  const { default: SessionProjectionRegistry } = modules['@deepseek-ai/dsh-session-projection']
  const bodies = []
  const fixtureToken = 'f'.repeat(64)
  let serverFailure
  const server = createServer(async (request, response) => {
    try {
      let text = ''
      for await (const chunk of request) text += chunk
      assert.equal(request.url, '/deepseek-harness')
      assert.equal(request.headers.authorization, `Bearer ${fixtureToken}`)
      bodies.push(JSON.parse(text))
      response.writeHead(200); response.end('{}')
    } catch (error) {
      serverFailure = error
      response.writeHead(500); response.end('{}')
    }
  })
  const priorPetDirectory = process.env.PET_USER_DATA
  let directory, ctx, plugin
  const waitFor = async predicate => {
    const deadline = Date.now() + 3_000
    while (!predicate()) {
      if (serverFailure) throw serverFailure
      if (Date.now() > deadline) throw new Error('Timed out waiting for Harness runtime state')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    directory = await mkdtemp(path.join(runtimeRoot, 'deskfolk-smoke-data-'))
    await writeFile(path.join(directory, 'bridge.json'), JSON.stringify({ port: server.address().port, token: fixtureToken }))
    process.env.PET_USER_DATA = directory
    ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const agents = new Map()
    ctx.provide('agents', { get: id => agents.get(id), list: () => [...agents.values()] })
    const session = ctx.sessions.create('runtime-smoke-main', { meta: { cwd: runtimeRoot } })
    const agent = { id: session.id, session, status: 'idle' }
    agents.set(agent.id, agent)
    const answer = { answers: [{ id: 'smoke', selected: ['OK'] }] }
    ctx.on('user-questions/request', async () => answer)
    plugin = await ctx.plugin(deskfolk)
    assert.equal(plugin.state, 2) // FiberState.ACTIVE is a type-only const enum.
    await waitFor(() => bodies.some(body => body.event === 'snapshot'))

    agent.status = 'running'
    session.append('turn/start', { turn: 1 })
    ctx.emit('agent/status', { agent, status: 'running' })
    session.append('approval/asked', { id: 'approval-smoke', toolName: 'bash', callId: 'smoke-call' })
    session.append('approval/decided', { id: 'approval-smoke', outcome: 'allowed-once' })
    const result = { isError: false, value: 'opaque-private-result' }
    const returned = await ctx.waterfall('tools/execute', {
      agent, callId: 'smoke-call', name: 'bash', arguments: { secret: 'PRIVATE_ARGUMENT' },
    }, () => Promise.resolve(result))
    assert.equal(returned, result)
    const request = { agent, questions: [{ id: 'smoke', question: 'PRIVATE_QUESTION' }], wait: { callId: 'smoke-question' } }
    const answered = await ctx.waterfall('user-questions/request', request, () => {
      throw new Error('The existing answerer should have claimed the request')
    })
    assert.equal(answered, answer)
    const rejection = new Error('PRIVATE_TOOL_FAILURE')
    await assert.rejects(ctx.waterfall('tools/execute', {
      agent, callId: 'failed-call', name: 'edit',
    }, () => Promise.reject(rejection)), error => error === rejection)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    agent.status = 'idle'
    ctx.emit('agent/status', { agent, status: 'idle' })
    await waitFor(() => bodies.some(body => body.event === 'agent/status' && body.status === 'idle' && body.turn === 1))

    assert(bodies.some(body => body.event === 'input/required' && body.kind === 'approval'))
    assert(bodies.some(body => body.event === 'input/resolved' && body.kind === 'approval'))
    assert(bodies.some(body => body.event === 'input/required' && body.kind === 'question'))
    assert(bodies.some(body => body.event === 'tool/call' && body.toolName === 'bash'))
    assert(bodies.some(body => body.event === 'turn/end' && body.reason === 'completed'))
    const encoded = JSON.stringify(bodies)
    for (const forbidden of ['PRIVATE_ARGUMENT', 'PRIVATE_QUESTION', 'PRIVATE_TOOL_FAILURE', 'opaque-private-result']) {
      assert(!encoded.includes(forbidden), 'Private fixture text reached the bridge')
    }
    await plugin.dispose()
    const countAfterDisposal = bodies.length
    await ctx.waterfall('tools/execute', { agent, callId: 'after-dispose', name: 'bash' }, () => Promise.resolve(result))
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(bodies.length, countAfterDisposal)
    if (serverFailure) throw serverFailure
    return {
      ok: true,
      runtime: versions,
      observedEvents: [...new Set(bodies.map(body => body.event))],
      nativeAnswerAndResultPreserved: true,
      privateTextAbsent: true,
      unloadRemovedListeners: true,
    }
  } finally {
    try {
      await ctx?.fiber.dispose()
    } finally {
      if (priorPetDirectory === undefined) delete process.env.PET_USER_DATA
      else process.env.PET_USER_DATA = priorPetDirectory
      server.closeAllConnections()
      if (server.listening) await new Promise(resolve => server.close(resolve))
      if (directory) {
        if (path.dirname(directory) !== runtimeRoot || !path.basename(directory).startsWith('deskfolk-smoke-data-')) {
          throw new Error('Unexpected smoke fixture cleanup target')
        }
        await rm(directory, { recursive: true, force: true })
      }
    }
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isMain) {
  try {
    const argv = process.argv.slice(2)
    if (argv.length === 1 && argv[0] === '--help') console.log(help)
    else {
      if (argv.length !== 2 || argv[0] !== '--runtime-dir' || !argv[1] || argv[1].startsWith('--')) {
        throw new Error('Specify --runtime-dir <directory>; use --help for usage')
      }
      console.log(JSON.stringify(await runRuntimeSmoke(argv[1]), null, 2))
    }
  } catch (error) {
    console.error(`Deskfolk Harness runtime smoke: ${error.message}`)
    process.exitCode = 1
  }
}

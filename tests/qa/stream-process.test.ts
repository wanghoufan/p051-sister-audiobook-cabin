/**
 * QA 回归测试 —— 以「真实子进程」方式跑 server.mjs，测量服务端资源占用。
 *
 * 为什么必须起子进程：fd 与 RSS 必须在「服务端进程」上量。
 * 在 vitest 进程内起 server（createServer）会把客户端 undici 的连接池
 * 也算进同一个 pid，测出来的数字没有意义。
 *
 * 覆盖：
 *   - 客户端中途断开后视频文件上的 fd 不随次数线性增长（server.mjs:245 的 close 处理）
 *   - 大 range 请求不会把整段视频读进内存（server.mjs:230 用 createReadStream）
 *   - 服务进程在大量中断后仍然健康
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import { execFile, execFileSync } from 'node:child_process'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const CHUNK = 30 * 1024 * 1024
const PORT = 18799

let child: ReturnType<typeof spawn>
let tempRoot: string
let streamUrl: string

async function freePort(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 50; port += 1) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = net.createServer()
      probe.once('error', () => resolve(false))
      probe.once('listening', () => probe.close(() => resolve(true)))
      probe.listen(port, '127.0.0.1')
    })
    if (free) return port
  }
  throw new Error('找不到可用端口')
}

function lsofLines(pid: number): Promise<string[]> {
  return new Promise((resolve) => {
    execFile('lsof', ['-p', String(pid)], { maxBuffer: 1 << 26 }, (_err, stdout) => {
      resolve(stdout.split('\n'))
    })
  })
}

async function mp4Fds(pid: number): Promise<number> {
  const lines = await lsofLines(pid)
  return lines.filter((l) => l.includes('.mp4') && !l.includes('/bin/')).length
}

/** 轮询直到视频 fd 计数连续两次相同（稳定），最多等 maxMs。 */
async function settledFds(pid: number, maxMs = 20_000): Promise<number> {
  const deadline = Date.now() + maxMs
  let previous = -1
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000))
    const current = await mp4Fds(pid)
    if (current === previous || Date.now() > deadline) return current
    previous = current
  }
}

function rssKb(pid: number): number {
  return Number.parseInt(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)]).toString().trim(), 10)
}

beforeAll(async () => {
  const port = await freePort(PORT)
  tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'p038-qa-stream-'))
  const catalogDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'p038-qa-stream-catalog-'))
  await fsp.mkdir(path.join(tempRoot, 'keep】'), { recursive: true })
  await fsp.writeFile(path.join(tempRoot, 'keep】/30mb 视频.mp4'), Buffer.alloc(CHUNK, 9))
  await fsp.writeFile(path.join(catalogDir, 'annotations.json'), JSON.stringify({ version: 1, videos: {} }))
  await fsp.writeFile(
    path.join(catalogDir, 'catalog-cache.json'),
    JSON.stringify({ 'keep】/30mb 视频.mp4': { durationSeconds: 600 } }),
    'utf8',
  )

  child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(__dirname, '../..'),
    env: {
      ...process.env,
      VIDEO_ROOT: tempRoot,
      ANNOTATIONS_FILE: path.join(catalogDir, 'annotations.json'),
      THUMBNAIL_DIR: path.join(catalogDir, 'thumbs'),
      APP_PORT: String(port),
      DIST_DIR: path.join(catalogDir, 'dist'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // 等待端口就绪
  const deadline = Date.now() + 20_000
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (res.ok) break
    } catch {
      /* 还没起来 */
    }
    if (Date.now() > deadline) throw new Error('server.mjs 启动超时')
    await new Promise((r) => setTimeout(r, 200))
  }
  const base = `http://127.0.0.1:${port}`
  const catalog = (await (await fetch(`${base}/api/videos`)).json()) as {
    videos: { id: string; playbackUrl: string }[]
  }
  streamUrl = `${base}${catalog.videos[0].playbackUrl}`
  ;(globalThis as Record<string, unknown>).__QA = { base, streamUrl }
}, 60_000)

afterAll(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise((r) => child.once('exit', () => r(true)))
    child.kill('SIGTERM')
    const ok = await Promise.race([exited, new Promise((r) => setTimeout(() => r(false), 3000))])
    if (!ok && child.exitCode === null) child.kill('SIGKILL')
  }
  await fsp.rm(tempRoot, { recursive: true, force: true })
})

function urls(): { base: string; streamUrl: string } {
  return (globalThis as Record<string, unknown>).__QA as { base: string; streamUrl: string }
}

describe('P0-3 服务端资源占用（真实子进程）', () => {
  it('启动成功且能返回 206', async () => {
    const res = await fetch(urls().streamUrl, { headers: { Range: 'bytes=0-99' } })
    expect(res.status).toBe(206)
    await res.arrayBuffer()
  })

  it('5 个并发 30MB range：服务端 RSS 增长远小于 150MB 传输总量（没有整段读进内存）', async () => {
    const pid = child.pid!
    // 先做一次请求把 JIT / 缓冲池预热，再取基线
    await (await fetch(urls().streamUrl, { headers: { Range: 'bytes=0-31457279' } })).arrayBuffer()
    await new Promise((r) => setTimeout(r, 300))
    const before = rssKb(pid)
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        fetch(urls().streamUrl, { headers: { Range: 'bytes=0-31457279' } }),
      ),
    )
    const peak = rssKb(pid)
    const sizes = await Promise.all(responses.map(async (r) => (await r.arrayBuffer()).byteLength))
    expect(sizes.every((n) => n === CHUNK)).toBe(true)
    const growth = peak - before
    // 整段缓冲会涨 ~150MB；流式传输只涨连接缓冲（实测 < 20MB）
    expect(growth, `RSS ${before}KB → ${peak}KB（增长 ${growth}KB，传输 150MB）`).toBeLessThan(40 * 1024)
  }, 120_000)

  it('客户端中途断开：80 次中断后视频文件上的 fd 有界（不随次数线性增长）', async () => {
    const pid = child.pid!
    const baseline = await mp4Fds(pid)
    const REQUESTS = 20
    const ROUNDS = 4
    const rounds: number[] = []
    for (let round = 0; round < ROUNDS; round += 1) {
      const ac = new AbortController()
      const inflight: Promise<unknown>[] = []
      for (let i = 0; i < REQUESTS; i += 1) {
        inflight.push(
          fetch(urls().streamUrl, { headers: { Range: 'bytes=0-20971519' }, signal: ac.signal }).catch(
            () => undefined,
          ),
        )
      }
      await new Promise((r) => setTimeout(r, 60))
      ac.abort()
      await Promise.all(inflight)
      // Node 回收 read stream 的时机受机器负载影响（本项目同时在跑 130 个视频的
      // ffmpeg 转码），所以这里轮询到「稳定」而不是死等固定秒数。
      rounds.push(await settledFds(pid))
    }
    const total = ROUNDS * REQUESTS
    // 关键性质：80 次中断之后仍然开着的视频 fd 必须远少于请求数。
    // 若 server.mjs:245 的 close 处理失效，这里会接近 80。
    expect(Math.max(...rounds), `基线 ${baseline}，四轮 settled fd：${rounds.join(' → ')}（共 ${total} 次中断）`)
      .toBeLessThan(total / 4)
    const health = await fetch(`${urls().base}/api/health`)
    expect(health.status).toBe(200)
  }, 180_000)

  it('60 次中断之后服务仍能正常整段流播（进程没被打挂）', async () => {
    const res = await fetch(urls().streamUrl, { headers: { Range: 'bytes=0-1048575' } })
    expect(res.status).toBe(206)
    expect((await res.arrayBuffer()).byteLength).toBe(1024 * 1024)
  }, 60_000)
})

import { defineConfig } from 'vitest/config'

/**
 * Vitest 3 已经废弃 `environmentMatchGlobs`（每次启动都会打 DEPRECATED 警告），
 * 官方替代方案是 `test.projects`：按「跑在什么环境」把测试拆成两个项目。
 *
 * 判定规则按扩展名，而不是按目录，这样别人新加 tests/xxx/ 目录不会被静默漏掉：
 *   - `*.test.ts`  → node 项目（纯 Node：fs / os / http / 起真实 server）
 *   - `*.test.tsx` → jsdom 项目（要渲染 React 组件，依赖 window / document）
 *
 * 旧的 environmentMatchGlobs 只按 tests/browser/** 切 jsdom；实际仓库里
 * tests/qa/ 下面也有 .tsx 组件测试，所以这里比旧规则更准：所有 .tsx 都进 jsdom。
 *
 * setupFiles 只能挂在 jsdom 项目上：如果 node 项目也加载 jest-dom，
 * 它的 setup 会去碰 document / expect 扩展，在纯 Node 环境里直接炸。
 * 各测试文件里原有的 `import '@testing-library/jest-dom/vitest'` 保留不动
 * （那些文件不属于本次改动范围），重复注册同一个 matcher 是幂等的。
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          globals: true,
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
        },
      },
      {
        test: {
          name: 'jsdom',
          globals: true,
          environment: 'jsdom',
          include: ['tests/**/*.test.tsx'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          setupFiles: ['./tests/setup-browser.ts'],
        },
      },
    ],
  },
})

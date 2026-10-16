/**
 * QA 专用 vitest 配置（QA 独占目录 tests/qa/**）。
 *
 * 为什么单独一份：根 vitest.config.ts 的 `test.projects` 只 include
 * tests/node、tests/unit、tests/browser 三个目录，tests/qa 不在里面；
 * 而根配置属于别的 agent 的文件，QA 不改。QA 用下面这条命令跑自己的回归：
 *
 *   npx vitest run --config tests/qa/vitest.config.ts
 *
 * 等价的 npm script（在 QA 报告里给出，package.json 同样不归 QA 改）：
 *   "test:qa": "vitest run --config tests/qa/vitest.config.ts"
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // JSX 用自动运行时（等价 vite.config.ts 里 @vitejs/plugin-react 的行为），
  // 否则 .tsx 测试里会报 "React is not defined"。
  esbuild: { jsx: 'automatic' },
  test: {
    projects: [
      {
        test: {
          name: 'qa-node',
          globals: true,
          environment: 'node',
          include: ['tests/qa/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'qa-browser',
          globals: true,
          environment: 'jsdom',
          include: ['tests/qa/**/*.test.tsx'],
          setupFiles: ['./tests/setup-browser.ts'],
        },
      },
    ],
  },
})

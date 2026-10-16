/**
 * jsdom 项目的集中 setup，只在 vitest.config.ts 的 `browser` 项目里通过
 * setupFiles 加载（node 项目绝不加载它）。
 *
 * 作用：把 @testing-library/jest-dom 的自定义 matcher
 * （toBeInTheDocument / toHaveTextContent / toBeVisible …）注册到 vitest 的
 * expect 上。各测试文件里已有的同名 import 保留，重复注册同一个 matcher 是幂等的。
 */
import '@testing-library/jest-dom/vitest'

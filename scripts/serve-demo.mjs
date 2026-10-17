import path from 'node:path';
import { createAudioServer } from '../audiobook-server.mjs';

const course = (id, num, title, note, level, category, count) => ({
  id,
  title,
  level,
  category,
  note,
  episodes: Array.from({ length: count }, (_, i) => ({
    id: `${id}-ep-${String(i + 1).padStart(2, '0')}`,
    courseId: id,
    ordinal: i + 1,
    title: `第 ${String(i + 1).padStart(2, '0')} 集`,
    section: '',
    sizeBytes: 8_000_000 + i * 400_000,
    durationSec: 600 + i * 45,
    integrity: 'ok',
    url: `/api/audio/demo-${id}-${i}`,
  })),
});

const snapshot = {
  courses: [
    course('demo-l3-1', 1, '示例课程 · 星星灯塔', '占位课程，仅用于展示界面结构。', 'L3', '文学', 12),
    course('demo-l3-2', 2, '示例课程 · 河谷回声', '占位课程，仅用于展示界面结构。', 'L3', '历史', 9),
    course('demo-l3-3', 3, '示例课程 · 数字森林', '占位课程，仅用于展示界面结构。', 'L3', '科学科普', 15),
    course('demo-l3-4', 4, '示例课程 · 雨声音阶', '占位课程，仅用于展示界面结构。', 'L3', '艺术音乐', 8),
    course('demo-l3-5', 5, '示例课程 · 地图边缘', '占位课程，仅用于展示界面结构。', 'L3', '地理博物', 10),
    course('demo-l3-6', 6, '示例课程 · 阁楼密钥', '占位课程，仅用于展示界面结构。', 'L3', '侦探推理', 7),
    course('demo-l3-7', 7, '示例课程 · 种子口袋', '占位课程，仅用于展示界面结构。', 'L3', '心理成长', 6),
    course('demo-l1-1', 8, '示例课程 · 云端牧场', '占位课程，仅用于展示界面结构。', 'L1', '文学', 20),
    course('demo-l1-2', 9, '示例课程 · 蜗牛邮政', '占位课程，仅用于展示界面结构。', 'L1', '地理博物', 5),
  ],
  records: {},
};

const port = Number(process.env.APP_PORT || 8793);
const server = createAudioServer({
  root: path.resolve('兴趣测试'),
  snapshot,
  distDir: path.resolve('dist'),
});
server.listen(port, '127.0.0.1', () => console.log(`演示实例 http://127.0.0.1:${port}`));

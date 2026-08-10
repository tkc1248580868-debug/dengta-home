# DengTa 原生手感与动画系统

## 目标

本层只改变视觉、材质和运动方式，不删除或替换 DengTa 的聊天、动态、日记、记忆、
档案、天气、设置、MCP、模型选择、附件、引用、建议、登录和通知功能。

运动原则来自项目内的设备测试：优先使用合成层动画，限制实时模糊层数，并为低性能设备和 `prefers-reduced-motion` 提供降级。

## 视觉映射

| 既有区域 | 新视觉形式 | 性能边界 |
| --- | --- | --- |
| 冷启动 | 单线摆动、收束成直线、DengTa 标识淡入 | App 在遮罩下并行初始化；只播放一次 |
| 动态栏 | 炭黑玻璃、静态心跳轨迹、玫瑰色光点横移 | 不再逐帧改变 SVG dash；滚动时暂停装饰动画 |
| 天气卡 | 珍珠白浮层 | 始终位于聊天背景之上，不覆盖输入框 |
| 聊天气泡 | 珍珠白与炭灰双材质 | 历史消息无集体入场动画；离屏消息跳过布局绘制 |
| 思考区域 | 区分模型公开摘要与后台处理状态 | 没有公开摘要时不再用固定文案冒充真实思考 |
| 加号菜单、对话框、详情抽屉 | 统一遮罩、轻位移和缩放弹簧 | 只动画 `transform` 与 `opacity` |
| 动态、日记、记忆、设置 | 同一书刊式排版与透明表面 | 重复卡片不用 `backdrop-filter` |
| 底部导航、顶栏、输入区 | 固定玻璃层 | 允许少量实时模糊，保持层数恒定 |

## 代码边界

- `src/DengTaPrelude.jsx`：冷启动开场。
- `src/native-feel.css`：最后加载的统一视觉层。
- `src/CompanionStatus.jsx`：保留静态 SVG 心跳轨迹，移动光点改为 HTML 合成层。
- `src/ChatMessageExtras.jsx`：公开思考摘要与普通处理状态分流。
- `test/native-motion.test.js`：禁止回退到持续 SVG 描边、布局属性动画和无降级动画。

## 动画规则

1. 位移只用 `transform`，显隐只用 `opacity`。
2. 不逐帧动画 `height`、`width`、`margin`、`padding`、`top`、`left` 或
   `scrollTop`。
3. 已经显示的流式消息完成落库时不得重挂载思考面板。
4. 长列表成员启用 `content-visibility: auto`，不允许全列表集体播放入场动画。
5. `prefers-reduced-motion` 下关闭开场、扫光、弹层和页面运动。
6. 真机滚动期间给消息列表加短暂 `is-scrolling` 状态，暂停非必要装饰动画。

## 验收

自动验收：

```text
npm test
npm run lint
npm run build
```

Android：

```text
minSdk 31
targetSdk 36
包名 home.dengta.app
```

仍需用 vivo X200 Ultra 的最新无线调试连接端口完成：

- 冷启动开场逐帧观看；
- 聊天长列表连续滚动；
- 动态栏展开与收起；
- 加号菜单、模型切换和弹窗；
- 输入法弹出后输入框与底栏不重叠；
- 冷启动、前后台切换及登录恢复。

# Aperture

**Aperture** 是 **ACI (Agent Context Interface)** 的可视化调试工具，使用 Electron + React + TypeScript 构建。

## 项目简介

ACI 是一个用于管理 AI Agent 上下文的框架。Aperture 作为其配套的调试工作台，提供了一个直观的桌面界面，帮助开发者：

- **观察** AI 与系统之间的交互过程
- **模拟** AI 的输出和工具调用
- **检查** 当前的系统上下文、窗口状态和 LLM 输入

## 功能特性

- **会话管理**：创建、切换、关闭调试会话
- **用户交互**：向 AI 发送消息并查看响应
- **模拟器**：
  - 模拟 AI 输出（包括 `<tool_call>` 指令）
  - 模拟 `create` 和 `action` 工具调用
  - 直接调用窗口 Action
- **检查器**：
  - 查看原始系统上下文
  - 查看 LLM 原始输入
  - 浏览当前活动窗口及其可用操作

## 快速开始

```bash
cd Aperture
npm install
npm run dev
```

默认后端地址：`http://localhost:5228`

## 构建

```bash
npm run build
```

## 许可证

本项目基于 [MIT 许可证](LICENSE) 开源。

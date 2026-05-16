# Git + LFS Web Helper

浏览器端 Git 操作面板 — 一键克隆/拉取/推送、文件上传/删除、大文件 LFS、命令速查表。**无需记住 Git Bash 命令。**

## 功能一览

| 功能 | 说明 |
|------|------|
| 一键 Clone/Pull/Push | 填写 URL 和 Token，点击按钮即可 |
| 文件上传 | 任意大小文件均可上传；≥100MB 自动走 LFS 分片上传 |
| 删除仓库文件 | 输入路径删除指定文件，提交后生效 |
| Add + Commit + Push | 一键暂存所有变更并推送到远程 |
| 分支管理 | 创建/切换/删除分支，可视化列表 |
| 提交历史 | 时间线展示最近 20 条 commit |
| 命令速查表 | 30 条常用命令，搜索过滤 + 一键复制 |
| 代理自动检测 | 启动时自动读取 Windows 系统代理设置，无需手动配置 |
| 推送指定分支 | Push 时可选择目标分支 |
| 深色模式 | 一键切换亮/暗主题 |

## 快速开始

### 方式一：双击启动（推荐）

1. 确保电脑已安装 [Node.js](https://nodejs.org/)（v16+）
2. 双击 **`start.bat`**
3. 自动安装依赖、启动服务、打开浏览器

### 方式二：手动启动

```bash
npm install
npm run dev
# 浏览器打开 http://localhost:5173
```

## 在其他设备上使用

将整个文件夹复制到目标设备（U盘、网盘均可），只需满足：
- 已安装 Node.js v16+
- 双击 `start.bat` 即可（首次会自动 `npm install`）

## 使用指南

### 1. 获取 GitHub Token

1. 打开 [GitHub Settings → Tokens](https://github.com/settings/tokens)
2. 点击 **Generate new token (classic)**
3. 勾选 `repo` 权限（完整仓库访问）
4. 生成后复制 `ghp_xxx` 格式的 token
5. 粘贴到网页的 Token 输入框（自动保存在浏览器）

### 2. 克隆仓库

- 填写仓库 URL（如 `https://github.com/owner/repo.git`）和 Token
- 点击 **Clone**
- 克隆完成后自动加载分支列表和提交历史

### 3. 日常操作

| 按钮 | 对应命令 | 说明 |
|------|----------|------|
| **Pull** | `git pull` | 拉取远程最新代码 |
| **Push** | `git push` | 推送本地提交到远程 |
| **Status** | `git status` | 查看工作区变更 |
| **Diff** | `git diff` | 查看具体差异内容 |
| **提交所有并推送** | `git add . && git commit && git push` | 一键提交推送，可指定目标分支 |

### 4. 上传文件

1. 拖拽文件/文件夹到上传区域（或点击选择）
2. 所有文件均可上传：
   - **< 100MB**：直接写入仓库虚拟文件系统
   - **≥ 100MB**：自动走 Git LFS 分片上传
3. 点击 **上传文件** → 上传完成后用"提交所有并推送"同步到远程

### 5. 删除仓库文件

1. 在"删除仓库文件"区域输入文件路径（如 `src/old.ts`）
2. 点击 **删除** → 确认
3. 文件从仓库移除，提交并推送后远程也会删除

### 6. 命令速查表

- 30 条常用 Git / Git LFS 命令
- 支持中英文搜索过滤
- 点击 **复制** 一键复制到剪贴板
- 危险命令红色标记提醒

## 命令详解

### 基础操作

| 命令 | 实际作用 |
|------|----------|
| `git init` | 在当前目录创建 `.git` 文件夹，初始化为 Git 仓库。 |
| `git clone <url>` | 从远程下载整个仓库到本地，相当于 `init` + `pull`。 |
| `git remote add origin <url>` | 关联远程地址，之后 push/pull 就知道往哪里同步。 |
| `git remote -v` | 显示当前关联的所有远程地址。 |

### 日常工作流

| 命令 | 实际作用 |
|------|----------|
| `git status` | 显示哪些文件被修改/新增/删除，哪些已暂存等待提交。 |
| `git add .` | 把所有变更加入暂存区（"下次提交要包含的内容"）。 |
| `git commit -m "message"` | 将暂存区打包成一个快照，附带说明。本地操作，不影响远程。 |
| `git push origin main` | 将本地新 commit 上传到远程仓库。 |
| `git pull origin main` | 从远程下载最新 commit 并合并到本地。 |
| `git diff` | 显示工作区与暂存区的逐行差异。 |

### 分支管理

| 命令 | 实际作用 |
|------|----------|
| `git branch -a` | 列出所有分支（本地 + 远程）。 |
| `git checkout -b <name>` | 创建新分支并切换过去。 |
| `git checkout <name>` | 切换到已有分支。 |
| `git merge <branch>` | 将指定分支的改动合并到当前分支。 |

### 暂存与撤销

| 命令 | 实际作用 |
|------|----------|
| `git stash` | 临时存起未提交的改动，工作区恢复干净。 |
| `git stash pop` | 恢复最近一次 stash 的改动。 |
| `git checkout -- <file>` | **危险** — 丢弃文件的未暂存修改，不可撤销。 |
| `git reset --soft HEAD~1` | **危险** — 撤销最近一次 commit，保留改动在暂存区。 |

### 历史与调试

| 命令 | 实际作用 |
|------|----------|
| `git log --oneline -20` | 单行格式显示最近 20 条 commit。 |
| `git blame <file>` | 逐行显示每行是谁在什么时候修改的。 |
| `git reflog` | 显示 HEAD 移动历史，误操作后的救命工具。 |
| `git cherry-pick <commit>` | 把某个 commit 单独应用到当前分支。 |
| `git rebase -i HEAD~3` | **危险** — 交互式修改最近 3 个 commit，会改写历史。 |

### Tag 标签

| 命令 | 实际作用 |
|------|----------|
| `git tag -a v1.0 -m "msg"` | 在当前 commit 打标签，标记版本发布。 |
| `git push origin --tags` | 推送所有标签到远程。 |

### Git LFS 大文件

| 命令 | 实际作用 |
|------|----------|
| `git lfs install` | 启用 LFS 支持，每个仓库执行一次。 |
| `git lfs track "*.psd"` | 所有 `.psd` 文件走 LFS 存储。 |
| `git lfs track "<filename>"` | 指定单个文件走 LFS。 |
| `git lfs track` | 列出所有 LFS 追踪规则。 |
| `git lfs ls-files` | 列出由 LFS 管理的文件。 |

> **LFS 原理**：仓库中只存指针文件（~130 字节），实际内容存在 LFS 服务器，clone 时不会下载所有大文件历史。

## 网络代理配置

通过 Vite 开发服务器中间件代理 GitHub 请求，解决浏览器 CORS 限制。

### 自动检测（推荐）

启动时自动读取 Windows 注册表中的系统代理设置（`ProxyEnable` / `ProxyServer`）。如果你已经开启了 Clash、V2Ray 等代理软件，无需任何配置即可使用。

页面顶部"网络状态"卡片会显示当前检测结果。

### 手动配置（.env）

也可以在项目根目录 `.env` 文件中手动指定：

#### 模式一：直连（默认）

```env
PROXY_MODE=direct
```

适合海外用户或已有全局代理的用户。直接连接 github.com。

#### 模式二：Steam++

```env
PROXY_MODE=steam++
```

使用 Steam++（Watt Toolkit）的 GitHub 加速功能，通过 127.0.0.1:443 转发。

#### 模式三：自定义代理

```env
PROXY_MODE=custom
PROXY_HOST=127.0.0.1
PROXY_PORT=7890
```

适配任意 HTTPS 代理（Clash、V2Ray、Shadowsocks 等），填写代理监听地址和端口即可。

> 修改 `.env` 后需重启开发服务器（关闭 start.bat 窗口后重新双击）。
> 自动检测优先级高于 `.env` 配置：如果检测到系统代理，会覆盖 `.env` 中的设置。

## 技术栈

| 技术 | 用途 |
|------|------|
| React 18 + TypeScript | UI 框架 |
| Vite 5 | 构建 + 开发服务器 + 代理 |
| isomorphic-git | 浏览器端 Git 引擎 |
| @isomorphic-git/lightning-fs | IndexedDB 虚拟文件系统 |
| GitHub LFS REST API | 大文件分片上传 |

## 注意事项

- Token 存储在浏览器 `localStorage`，仅存在于本地
- 仓库文件存储在浏览器 IndexedDB（容量取决于浏览器）
- LFS 上传需要仓库已启用 Git LFS
- 建议使用 Chrome / Edge
- 需要 Node.js 运行开发服务器（提供代理功能）

## License

MIT

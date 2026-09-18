# nextmusic-release

`mubeyout/nextmusic` Docker 镜像的构建上下文仓库——**GitHub Actions 自动构建并推送 Docker Hub**。

- 内容：`Dockerfile` + 分层改动声明 `NOTICE.md`（基座 lxserver, Apache-2.0）+ 构建产物（控制台 v3.x / 播放器 / 服务端树 / bcryptjs）
- 每次发布：Kai 从生产容器净化导出最新产物 → 提交到本仓库 main → Actions 自动构建推送 `latest` + 日期 tag
- 凭据：仓库 Secrets `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN`（仅这两个，别的不需要）

## 镜像使用
见 [NextMusic/docker](https://github.com/mubeyout/NextMusic/tree/main/docker)（compose + 部署说明）。

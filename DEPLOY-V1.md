# NextMusic V1 部署指南（Docker 版）

## 两个包是什么

| 包 | 大小 | 内容 |
|---|---|---|
| `nextmusic-server-v1-docker-image.tar.gz` | ~432MB | **Docker 完整版**：node 运行时 + API 后端 + 内置 web（docker load 即起，离线可用） |
| `NextMusic-HDWeb-v1-dist.tgz` | ~25MB | **web 前端静态文件**（HD 形态 + /admin 后台管理，V1 最新 11-19 版）——用于覆盖镜像内旧前端 |

dist 小是正常的：它只是 HTML/JS/CSS 静态文件（单页应用），不含 node、不含后端、不含音源逻辑——后端全在 docker 镜像里。

## 部署三步（推荐）

```bash
# 1. 载入镜像并启动（数据目录挂出来持久化）
docker load -i nextmusic-server-v1-docker-image.tar.gz
docker run -d --name nextmusic --restart unless-stopped \
  -p 9527:9527 \
  -v /opt/nextmusic/data:/server/data \
  nextmusic-server:latest

# 2. 更新前端到 V1 最新版（含前后台 /admin）
tar xzf NextMusic-HDWeb-v1-dist.tgz
docker cp dist/. nextmusic:/server/public/music/

# 3. 浏览器访问
#   http://<服务器IP>:9527/       → HD 大屏界面
#   http://<服务器IP>:9527/admin/  → 后台管理
```

## 备选：从源码自建镜像

```bash
git clone https://github.com/mubeyout/nextmusic-release.git
cd nextmusic-release
docker build -t nextmusic-server:v1 .
# 然后 run 同上
```

## 说明
- 数据（账号/歌单/设置）全在 `/server/data` 挂载目录，容器删了重建不丢
- 镜像内置的 web 是 09-28 版；想要 11-19 前后台（real24：真实登录/音源/播放/播客）就执行第 2 步覆盖
- 更新通道（App 内检查更新）文件放 `/server/public/downloads/`（update.json + universal APK），本 V1 包未含，后续 V2 提供

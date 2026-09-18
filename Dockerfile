FROM ghcr.io/xcq0607/lxserver:latest
LABEL org.opencontainers.image.title="NextMusic Server" \
      org.opencontainers.image.description="NextMusic 自托管音乐服务器(播放器+控制台),基于 lxserver(Apache-2.0)" \
      org.opencontainers.image.licenses="Apache-2.0"
COPY NOTICE.md /server/NOTICE.md
COPY public/ /server/public/
COPY server/ /server/server/
COPY bcryptjs/ /server/node_modules/bcryptjs/
VOLUME ["/server/data"]

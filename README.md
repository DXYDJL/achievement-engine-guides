# Achievement Engine 社区攻略仓库

本仓库用于《成就引擎》社区攻略的审核与版本发布，目前为私有试运行。`catalog/index.json` 只列出已审核并发布的攻略；投稿先进入 `submissions/` 分支和审核 PR，不能仅凭上传进入目录。

攻略内容采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 许可。单攻略上传上限为十进制 500 MB，单个文件上限为 100 MB。服务端会流式接收包体，并逐张解码、重新编码图片，清除元数据后才将净化后的攻略包写入草稿 Release。完整服务配置及上线条件见主项目的 `community-service/README.md`。

仓库初始化后还需安装仅限本仓库的 GitHub App，配置 `GUIDE_REVIEWER_LOGINS`、`GUIDE_APP_VERSION` 和 `guide-publishing` 环境审核，并保护 `main` 分支。完成这些配置前，不应把本仓库当作可用的社区发布服务。

# Achievement Engine 社区攻略仓库

本仓库用于《成就引擎》社区攻略的审核与版本发布，目前为私有试运行。`catalog/index.json` 只列出已审核并发布的攻略；投稿先进入 `submissions/` 分支和审核 PR，不能仅凭上传进入目录。

攻略内容采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 许可。单攻略的目标上限为十进制 500 MB；当前服务的试运行接收上限为 25 MiB，且暂不接受图片投稿。完整服务配置及上线条件见主项目的 `community-service/README.md`。

仓库初始化后还需安装仅限本仓库的 GitHub App，配置 `GUIDE_REVIEWER_LOGINS`、`GUIDE_APP_VERSION` 和 `guide-publishing` 环境审核，并保护 `main` 分支。完成这些配置前，不应把本仓库当作可用的社区发布服务。

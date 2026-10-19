# Achievement Engine 社区攻略仓库

本仓库用于《成就引擎》社区攻略的自动校验与版本发布，目前为私有试运行。`catalog/index.json` 只列出自动规则全部通过并发布的攻略；投稿先进入 `submissions/` 分支和 PR，校验工作流通过后自动合并，再由独立工作流复验并发布。

攻略内容采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 许可。单攻略上传上限为十进制 500 MB，单个文件上限为 100 MB。服务端会流式接收包体，并逐张解码、重新编码图片，清除元数据后才将净化后的攻略包写入草稿 Release。完整服务配置及上线条件见主项目的 `community-service/README.md`。

仓库初始化后还需安装仅限本仓库的 GitHub App，并配置仓库变量 `GUIDE_APP_VERSION`（如 `0.8.4`）。Actions 工作流需要 `contents: write` 和 `pull-requests: write`，并允许 `workflow_run` 发布工作流读取 Actions 运行记录。自动规则范围与无法自动判断的内容见 `policy/content-policy.md`。


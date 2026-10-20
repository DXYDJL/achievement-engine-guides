# Achievement Engine 社区攻略仓库

本仓库用于《成就引擎》社区攻略的校验、人工审核与版本发布。已发布攻略的目录与 Release 资产公开可读，无需 GitHub 登录。`catalog/index.json` 只列出审核通过并发布的攻略。桌面软件通过 GitHub 设备授权登录后，在投稿者自己的公开 fork 中创建待审核 Release 和 `submissions/` 分支，再向本仓库提交 PR；PR 中按攻略单元保存变更。普通投稿者没有仓库写权限，不能直接修改正式目录。技术检查通过后，`dxydjl0521-maker` 可合并本人投稿；其他投稿须由 `dxydjl0521-maker` 或 `DXYDJL` 之一批准，并由其中之一合并，之后触发重新校验与发布。

同一游戏和语言可以收录多个独立攻略系列（不同 `guideId`）；同一系列的版本更新基于该 `guideId` 的最新已发布版本。

攻略内容采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 许可。单攻略上传上限为十进制 500 MB，单个文件上限为 100 MB。桌面软件在本地校验包体并逐张解码、重新编码图片后上传；只读的 PR 工作流会重新下载完整包并核对结构、身份、许可和 SHA-256。合并后的发布工作流再次核对，并将资源复制到正式 Release。旧版本地社区服务仍可用于维护者自托管流程。

桌面设备授权使用开发者注册的 GitHub OAuth App Client ID，不需要 Client Secret；首次授权的 `public_repo` 权限由 GitHub 授予，覆盖投稿者所有公开仓库，桌面软件只在攻略仓库 fork 中写入。仓库变量 `GUIDE_APP_VERSION`（如 `0.8.5`）须与当前包格式兼容。校验工作流只需读取权限，发布工作流需要 `contents: write` 和 `pull-requests: read`。`dxydjl0521-maker` 提交的攻略可以由本人合并发布；其他投稿须由 `dxydjl0521-maker` 或 `DXYDJL` 对最终 PR 提交批准，并由这两者之一合并。自动规则范围与无法自动判断的内容见 `policy/content-policy.md`。

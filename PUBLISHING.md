# 发布准备与步骤

官方资料核查日期：2026-10-24。建议顺序：Chrome → Edge → Firefox；当前没有商店上架记录或签名 XPI。公开仓库当前未附开源许可证，不能将其宣传为已采用 MIT 等开源授权。

## 生成安装包

从项目根目录运行：

```bash
python3 scripts/package.py
```

输出位于 `dist/`：`*-chromium.zip` 用于 Chrome / Edge，`*-firefox.zip` 用于 Mozilla。清单位于 ZIP 根目录；只包含清单、运行源码和四个 PNG 图标。测试、Git 元数据、本地记录、演示 GIF 和原始图片不进入安装包。Chromium 包去除 Firefox 专用清单字段；Firefox 包保留固定 ID 和数据声明。ZIP 本身不代表商店审核通过，Firefox 包也尚未签名。

代码没有压缩、混淆或编译步骤，上传包中的 JS 即运行源码。源码仓库公开与商店发行分别管理；当前未附开源许可证，来源记录见 PROVENANCE.md。

## 商店文案

中文简介：为 ChatGPT 长会话提供问题目录与回答章节导航，支持合并树、双侧布局及亮暗主题。

英文简介：Navigate ChatGPT questions and answer headings with an outline tree, split panels and light or dark themes.

中文详细介绍：

> 在长会话中快速找到问题与回答章节。目录可合并成树形菜单，也可分别显示问题和回答大纲；支持左右切换、固定面板、亮暗主题、整个会话首尾跳转和本地目录缓存。展开面板时正文预留空间。首次完整加载历史有提示，支持停止并恢复阅读位置。
>
> 仅支持桌面浏览器中的 chatgpt.com。目录来自页面现有标题，不使用 AI 自动总结。设置和目录元数据仅保存在当前浏览器，不上传会话内容。此扩展为独立开发工具，与 OpenAI 无关联。

## 权限及隐私填写依据

| 字段 | 填写依据 |
| --- | --- |
| 单一用途 | 在 ChatGPT 当前会话中导航问题与回答章节 |
| storage | 保存布局、主题及最近会话的目录元数据，减少重复扫描 |
| chatgpt.com 页面访问 | 读取页面问答及标题，显示目录并滚动到选定位置 |
| 远程代码 | 无；所有执行代码随扩展安装包提供 |
| 用户数据 | 会话页面内容在本地处理，问题和章节标题可能含个人信息；不上传、不出售、不用于广告 |
| 隐私政策 | [PRIVACY.md](PRIVACY.md)；发布前需提供公开可访问的网址 |

商店的实际勾选项以后台当前字段定义为准，不能把“不上传”直接替换成“不访问任何用户数据”。Chrome 要求如实说明用途、权限、远程代码和数据使用，参见 [官方隐私填写指南](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)。

## Chrome

1. 进入 [Chrome Web Store 开发者后台](https://chrome.google.com/webstore/devconsole)，由账号所有者注册、接受协议并支付一次性注册费，金额以后台为准。参见 [注册说明](https://developer.chrome.com/docs/webstore/register)。
2. 新建扩展，上传 `*-chromium.zip`，填写名称、描述、分类、语言和支持渠道。
3. 准备 128×128 PNG 图标、至少一张 1280×800 或 640×400 的实际功能截图；440×280 小宣传图为可选推荐素材。本候选的 128 图标已按方形图标规范导出为 96 像素图形加四边 16 像素透明边距。保留工具栏 16/32 图标的清晰度。参见 [图片规格](https://developer.chrome.com/docs/webstore/images)。
4. 上传公开隐私政策链接，按上表说明权限和数据使用；填写分发范围及测试说明。
5. 检查全部字段后提交审核；可选择审核通过后手动发布。参见 [发布流程](https://developer.chrome.com/docs/webstore/publish)。

审核测试说明：登录自己的 ChatGPT 测试账号，创建含多个问答和 Markdown 标题的会话，刷新页面；打开配置切换四种布局和亮暗主题；展开目录并等待扫描结束，检查问题、章节及首尾按钮。无需使用维护者真实账号或分享认证凭据。

## Edge

1. 使用 Microsoft 账号在 [Partner Center](https://partner.microsoft.com/) 注册 Edge 扩展开发者，Edge 扩展项目没有注册费，参见 [官方注册说明](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account)。
2. 新建扩展，上传同一个 `*-chromium.zip`。
3. 填写商店属性、图片、可用地区、可见性、隐私和审核说明，后台确认各图片尺寸后提交。参见 [官方发布流程](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)。

## Firefox

1. 在 [AMO 开发者中心](https://addons.mozilla.org/developers/) 登录 Mozilla 账号，选择公开上架，或者仅签名后自行分发。
2. 上传 `*-firefox.zip` 并运行平台校验；按 [提交说明](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/) 填写平台、名称、介绍、支持渠道、许可证和隐私资料。
3. 保留扩展 ID `@chatgpt-outline`，更新版本使用原条目。长期安装需要签名后的 XPI，不能将普通 ZIP 改名当作签名版。
4. 当前清单要求 Firefox 157 或更新版本，较早版本曾有原生测试记录，本轮修改仍需补验；140 ESR 配置页未通过。若要降低最低版本，先定位旧版失败并复测，不能宣传未验证的兼容范围。

## 发布前仍需完成

- 按 [docs/release-checklist.md](docs/release-checklist.md) 验收新发布包、真实 ChatGPT 长历史、鼠标展开和小屏幕避让；兼容范围说明另见 `docs/browser-compatibility.md`。
- 选定公开支持邮箱或网站，部署公开隐私页面；私有 GitHub 链接不能供未登录用户查看。
- 提供最新、不含个人会话的商店截图及规范的商店图标；小宣传图按需提供。
- 来源与许可现状见 PROVENANCE.md；当前未附开源许可证。若识别到第三方内容，需核对适用条款并保留相应声明，不能通过另加许可证改变其权利。
- 商店注册、费用、开发者协议、最终提交由账号所有者确认；本轮仅准备代码及发布材料。

商店发布和 GitHub 推送是独立步骤：私有源码仓库可以保留私有，公开分发扩展仍需对用户公开必要的隐私说明与支持渠道。

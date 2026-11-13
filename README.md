# 任务管家 2.0

面向 iPhone 和安卓浏览器的个人任务管理网页。登录同一 ChatGPT 账号同步数据。现有网站保持仅所有者访问。

## 使用

1. 打开 https://study-inbox-jasmine-nov12.leanrhubarb2.chatgpt.site ，使用创建本网站的同一账号登录。
2. 在微信、QQ、学习通中复制消息或保存截图，进入「转入」。也支持 UTF-8 TXT / MD 文件。选择来源、原消息日期和课程，再整理。
3. 所有识别结果进入「待确认」，核对期限、完成形式和适用对象，勾选加入。相似事项先比较再合并。
4. 「待办」可添加个人事项、计划日期、步骤、预计用时及重复周期。完成后保留在「已完成」，直到自己删除。
5. 换设备前确认右上角「已同步」。在另一设备登录同一账号，打开页面或点「立即同步」。离线修改先保存在当前浏览器，联网后重试。
6. 「我的」支持身份资料、指定来源、深浅主题、JSON 备份与恢复、日历导出。

## 手机提示

- iPhone 使用 Safari；分享菜单可选择「添加到主屏幕」。安卓使用 Chrome 等现代浏览器，可通过菜单添加到主屏幕。
- 粘贴按钮受浏览器权限限制，失败时长按输入框粘贴。
- 截图仅在本机识别，不上传原图。提取后的文字随任务同步到个人云端空间。首次 OCR 需要下载识别资源。
- 未接付费 AI。规则解析与 OCR 可能误判，务必确认日期、班级、小组与提交要求。
- 网页打开时可显示到期提示；关闭网页后的提醒使用导出的系统日历，不提供后台推送。
- 仅提供手机网页，未交付 App Store / APK 原生应用，也不保证离线首次加载。

## 接入范围

当前按用户确认采用主动转入。没有连接微信、QQ 或学习通账号，不会自动读取其他应用或补取群历史。近 7 天记录仅覆盖实际转入的信息。来源名称是归类标签，不是授权连接。

将来 QQ 接入需要官方机器人应用凭证、群内添加及平台消息权限；超星接入需要开放平台应用及相应接口授权。网页登录不代表其他平台授权。

## 数据与同步

浏览器 localStorage 保存本机副本；云端 D1 按登录用户 ID 保存快照。服务端验证身份、载荷和版本号，采用乐观并发更新。两端同时编辑时保留待核对副本；永久删除使用墓碑标记避免被旧设备恢复。请定期导出备份。

## 开发

Node >=22.13，安装依赖后 npm run dev。采用 Sites Vinext starter，保留其构建与环境脚本。生产构建使用 Sites build-site.mjs；通过 Sites 发布并配置 D1。数据库 schema 在 db/schema.ts，迁移在 drizzle/。本机开发必须应用迁移，不得将测试身份用于生产。

前端 public/，云端 API app/api/sync/route.ts，合并 public/sync-core.js。无 AI 密钥及第三方账号密码。

## 验证记录

2026-11-13：生产构建通过；Chrome 自动化验证两个独立会话同步、未登录拒绝、请求校验、过期版本冲突、重复事项生成、步骤完成、归档保留、文件转入、真实中文 OCR、去重合并、备份恢复；320/390/768/1440 像素下五个主页面无横向溢出。尚未完成实体 iPhone / Android 与 Safari WebKit 实机测试。

## 设计参考

参考 Things Today/Upcoming 与 Todoist Upcoming 对日期计划的组织，采用一周视图、五项底部导航、暖白背景与深蓝文字，强调色用于主要操作。

- https://culturedcode.com/things/support/articles/4001304/
- https://www.todoist.com/help/todoist/get-started/plan-your-week-with-the-upcoming-view-OKOg1mR8
- https://developer.apple.com/design/human-interface-guidelines/tab-bars
- https://bot.q.qq.com/wiki/develop/api-v2/
- https://auth.open.chaoxing.com/open/doc/list/yluywps0/zpsakobd/u58aqj3r

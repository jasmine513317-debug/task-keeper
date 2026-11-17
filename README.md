# 任务管家 2.0

面向 iPhone 和安卓浏览器的个人任务管理网页。用邮箱和密码注册登录，同一账号跨设备同步。现有网站保持仅所有者访问。

## 使用

1. 打开 https://study-inbox-jasmine-nov12.leanrhubarb2.chatgpt.site ，在「我的 → 账号与同步」中注册或登录。不登录也能在本机记录事项，只是不会上传。
2. 在微信、QQ、学习通中复制消息或保存截图，进入「转入」。也支持 UTF-8 TXT / MD 文件。选择来源、原消息日期和课程，再整理。
3. 所有识别结果进入「待确认」，核对期限、完成形式和适用对象，勾选加入。相似事项先比较再合并。
4. 「待办」可添加个人事项、计划日期、步骤、预计用时及重复周期。完成后保留在「已完成」，直到自己删除。
5. 目录按「分类 → 课程或项目」自动汇总，不额外建档。手机端点顶栏「目录」打开抽屉，电脑端在左侧栏；点任意一级就只筛出这一类，逾期数与待核对数直接标在节点上，面包屑上的 × 或分类下拉可清除筛选。目录只作用于「待办」与「已完成」。
6. 换设备前确认右上角「已同步」。在另一设备登录同一账号，打开页面或点「立即同步」。离线修改先保存在当前浏览器，联网后重试。
7. 「我的」支持注册登录、修改密码、身份资料、指定来源、深浅主题、JSON 备份与恢复、日历导出。

## 手机提示

- iPhone 使用 Safari；分享菜单可选择「添加到主屏幕」。安卓使用 Chrome 等现代浏览器，可通过菜单添加到主屏幕。
- 手机优先：顶栏压成一行，筛选横滑，右下角悬浮「＋」直接添加事项（避开底部导航和全面屏手势区），目录放在左侧抽屉里；页面底部预留了安全区。宽屏仍有侧栏，不因为手机改版而退化。
- 粘贴按钮受浏览器权限限制，失败时长按输入框粘贴。
- 截图仅在本机识别，不上传原图。提取后的文字随任务同步到个人云端空间。首次 OCR 需要下载识别资源。
- 未接付费 AI。规则解析与 OCR 可能误判，务必确认日期、班级、小组与提交要求。
- 网页打开时可显示到期提示；关闭网页后的提醒使用导出的系统日历，不提供后台推送。
- 仅提供手机网页，未交付 App Store / APK 原生应用，也不保证离线首次加载。

## 接入范围

当前按用户确认采用主动转入。没有连接微信、QQ 或学习通账号，不会自动读取其他应用或补取群历史。近 7 天记录仅覆盖实际转入的信息。来源名称是归类标签，不是授权连接。

将来 QQ 接入需要官方机器人应用凭证、群内添加及平台消息权限；超星接入需要开放平台应用及相应接口授权。网页登录不代表其他平台授权。

读取通知同样做不到：网页拿不到系统通知栏内容，iOS 完全不开这类接口，安卓也只能由已安装的原生 App 经用户授权监听，且多数只给到横幅预览文字。微信没有读取聊天记录的开放接口，并对注入、导出本地聊天记录的工具下风控封号；QQ 官方机器人只能看到被拉进的群、且主动消息每月有限次数。本版继续用复制文字与截图转入，识别全部在本机完成。

## 账号

多人各自用邮箱 + 密码注册，第一个注册的账号自动成为站点管理员。密码用 PBKDF2-SHA256 加盐存储（默认 15 万次迭代，可用 `AUTH_PBKDF2_ITERATIONS` 调整），服务端不保存明文，也看不到你的密码。

会话是 HMAC 签名的 HttpOnly Cookie，有效期 30 天，不入库。Cookie 名带 `__Host-` 前缀，同一个共享域名下的其他站点就无法给我们塞一个同名 Cookie。修改或被管理员重置密码会让 `session_epoch` 递增，此前签发的所有设备登录立即失效——这就是没有会话表的吊销方式。改了 Cookie 名之后，两边部署上已登录的设备都要重新登录一次。

忘记密码不发邮件，由管理员在「我的 → 重置他人密码」设置新密码并私下转达，之后本人应立刻改掉。登录、注册按邮箱与来源 IP 计数限流（同一邮箱 15 分钟内 8 次失败即锁；IP 阈值刻意放宽，因为一个班共用同一个出口 IP）。四处密码输入（登录、注册、修改密码、管理员重置）右侧都带「显示 / 隐藏」开关，只在当前页面切换输入框类型，不记录也不上报内容。

浏览器记录本机数据归属哪个账号。换账号登录时会先弹出提示，让你选择导出备份、清空本机或退回原账号，避免把上一个账号的事项同步进新账号。

## 数据与同步

浏览器 localStorage 保存本机副本；云端按登录用户 ID 保存快照，Cloudflare 版存 D1，Qoder Sites 版存平台数据库的 `app.tk_snapshots`。服务端验证身份、载荷和版本号，采用乐观并发更新。两端同时编辑时保留待核对副本；永久删除使用墓碑标记避免被旧设备恢复。请定期导出备份。

两套云端各用各的数据库，账号与快照互不相通；换站点时先在本机导出备份，再在新站点登录导入。

## 开发

Node >=22.13，安装依赖后 npm run dev。采用 Sites Vinext starter，保留其构建与环境脚本。生产构建使用 Sites build-site.mjs；通过 Sites 发布并配置 D1。数据库 schema 在 db/schema.ts，迁移在 drizzle/。本机开发必须应用迁移，不得将测试身份用于生产。

新增 `users` 与 `auth_attempts` 两张表尚未生成迁移文件（`drizzle/` 里目前只有 `0000_*` 建的 `task_snapshots`）。先跑 `npm run db:generate` 生成 `0001_*.sql`，再把 SQL 应用到 D1（`wrangler d1 migrations apply DB --remote`，或在 Sites 的数据库迁移里执行同一份 SQL）。手工补 SQL 而不补 `drizzle/meta/` 快照会让后续 `db:generate` 误判表结构，所以不要绕过生成器。

同时必须配置 `AUTH_SECRET`（至少 32 个字符，用 `openssl rand -base64 48` 之类生成，绝不写进仓库）；没有它时所有登录接口返回 503，而不是退化成可预测的签名密钥。本机预览放在 `.dev.vars`，生产放在 Sites 的密钥设置里。仓库的 `.gitignore` 已排除 `.dev.vars*` 与 `.env*`。

前端 public/（账号界面在 public/auth.js，目录在 public/directory.js，每日名言在 public/quotes.js），云端 API app/api/sync/route.ts 与 app/api/auth/*，纯逻辑在 lib/auth-core.js，合并 public/sync-core.js。截图识别出的整屏文字先由 public/core.js 的 `tidyOcr` 去掉状态栏时间、按钮文字和群名标题、把折行的半句拼回原句，再交给 `extract` 拆成事项，所以「转入」页只产出待确认列表，不会把整屏文字堆进事项里。无 AI 密钥及第三方账号密码。接口前缀由 `public/app.js` 的 `API_BASE` 决定，默认 `/api`；Qoder Sites 版在 `site/index.html` 里用 `window.TASK_KEEPER_API_BASE` 改成 `/functions/v1/app/api`，两边共用同一份前端源码。

Qoder Sites 版另有一份 Function：`functions/index.ts` + `functions/routes.mjs` + `functions/store.mjs`，账号原语 `functions/auth-core.mjs` 是 `lib/auth-core.js` 的逐字节副本（测试会核对两者一致）。平台数据库 SDK 只给 PostgREST 式条件，没有原子自增也没有事务，所以 D1 批次里的三件事换了写法：注册用 `app.tk_locks` 的唯一行抢占「第一个账号」，改密与被管理员重置用 `session_epoch` 条件写，同步用 `revision` 条件写。表结构在 `db/sites-schema.sql`，走平台的迁移审核流程应用；它刻意不放在 `functions/` 里，那个目录只收 `.ts` / `.mjs`。

静态站点目录这样生成：`rm -rf site && cp -r public site`，再在 `site/index.html` 的 `<script src="core.js">` 前插入一行 `window.TASK_KEEPER_API_BASE='/functions/v1/app/api'`。`site/` 是构建产物，不要手工改。

`npm test` 用 node --test 跑 tests/；`tests/index.html` 在浏览器里跑同一套用例（含 lib/auth-core.js 的真实 WebCrypto 路径）。Sites 那份用例（`tests/sites-suite.js`）把真实的 `functions/routes.mjs` 跑在一个模拟平台 SDK 的假数据库上，浏览器与 Node 都能执行。本机没有 Deno 也没有 Node，Function 的真实启动、平台 SDK 与 Gateway 的头处理都只能在部署后验证；Cloudflare 版的路由处理函数依赖 Workers 运行时与 D1，同样需要部署后复验。

## 验证记录

2026-11-13：生产构建通过；Chrome 自动化验证两个独立会话同步、未登录拒绝、请求校验、过期版本冲突、重复事项生成、步骤完成、归档保留、文件转入、真实中文 OCR、去重合并、备份恢复；320/390/768/1440 像素下五个主页面无横向溢出。尚未完成实体 iPhone / Android 与 Safari WebKit 实机测试。
2026-11-17：新增 tests/（96 项，覆盖期限解析、重复与相似判定、三向合并、日历导出与账号原语），修掉其中暴露的 4 个缺陷：一句话含多个日期时被整段忽略、来源未去重、远端删除会被旧设备复活、全天事项的提醒锚点算错。身份改为邮箱 + 密码：登录、注册、改密、管理员重置与跨账号本机数据保护已在浏览器实机走通（会话接口以桩替代）。`app/api/**` 的处理函数、D1 SQL 和 PBKDF2 的实际耗时依赖 Workers 运行时，本机无 Node 未执行，需在部署后复验；`AUTH_PBKDF2_ITERATIONS` 若超出 `cpu_ms` 预算会表现为登录 500。

同日第二轮（手机优先 + 暖色 + 目录）：`public/directory.js` 用已有 `category` / `course` 字段自动汇总两级目录，不改数据模型，云端 `validState` 与旧快照原样兼容。Chromium 里 320/390/640/641/768/1440 像素（同文档内用等宽视口实测）五个页面均无横向溢出：≤640 出现顶栏「目录」抽屉与右下角悬浮＋，≥641 恢复侧栏目录与页头添加按钮。抽屉取节点 → 筛选、面包屑清除、跨页面跳转、悬浮＋打开表单、识别中隐藏悬浮按钮均已实机点过。配色扫描遍历五个页面与两个弹窗的深浅主题，已无冷色残留；顺带修掉深色主题下侧栏选中项文字与底色几乎同色的旧问题。截图识别改为单张失败只跳过、保留其余结果，用一张真实截图加一张损坏文件混合提交验证（识别出行文字并提示另 1 张未识别）。`tests/index.html` 仍是 96 项全部通过；目录属界面层，没有自动化用例，只靠实机验证。`icon-192.png` / `icon-512.png` 仍是旧绿色（本机没有图片处理工具，只改了 `icon.svg`）。实体 iPhone / Android 与 Safari WebKit 仍未测。

同日第三轮（密码显示开关 + 云端只读复核）：`public/auth.js` 给登录、注册、修改密码、管理员重置共四处密码框加上「显示 / 隐藏」开关。Chromium 实测一处 / 两处 / 三处 / 一处开关逐一点过，`type` 在 `password` 与 `text` 之间正确来回切换并把光标留在末尾；320 / 390 / 768 像素下按钮落在输入框右内侧、弹窗与页面无横向溢出。`tests/index.html` 128 项全部通过。线上只读复核结果：`/api/health` 200；不带 Cookie 的 `auth/session` 与 `sync` 均 401 `login_required`；不存在的邮箱登录 401 `invalid_credentials`；过短密码注册 400 `weak_password`；缺 `X-Task-Keeper` 头 403 `invalid_request`。平台库里首个账号已存在，`tk_locks` 的 `first-account` 由它抢占（管理员自动认领生效），`tk_snapshots` 出现 `revision=1`，说明注册 → 登录 → 上传快照在真实环境走通；Function 日志窗口内无错误记录。仍未验证：409 过期版本冲突、改密后被吊销的旧会话、管理员重置他人密码、429 限流触发——这些需要真实凭据或测试账号，而本机不拿生产身份做测试。复核期间留下两条失败计数（一个 `example.invalid` 探测邮箱与本机出口 IP 各 1 次），按 15 分钟窗口自然失效，不影响登录。

## 设计参考

参考 Things Today/Upcoming 与 Todoist Upcoming 对日期计划的组织，采用一周视图、五项底部导航。配色为奶油白底（`#FBF6EF`）、暖白纸面卡片（`#FFFDF9`）、陶土橙主色（`#C15E3C`）与暖墨文字（`#4A3B32`），完成态用低饱和鼠尾草绿区分；深色主题改用暖黑底与浅陶土橙，不再使用冷蓝。主题变量集中在 `public/design-v2.css` 的 `:root`，`--green` 等历史变量名保留，实际值是陶土橙。

- https://culturedcode.com/things/support/articles/4001304/
- https://www.todoist.com/help/todoist/get-started/plan-your-week-with-the-upcoming-view-OKOg1mR8
- https://developer.apple.com/design/human-interface-guidelines/tab-bars
- https://bot.q.qq.com/wiki/develop/api-v2/
- https://auth.open.chaoxing.com/open/doc/list/yluywps0/zpsakobd/u58aqj3r

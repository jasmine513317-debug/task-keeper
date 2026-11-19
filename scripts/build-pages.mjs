import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../public/', import.meta.url));
if (!process.argv[2]) throw new Error('Pass a new output directory');
const output = resolve(process.argv[2]);
await mkdir(output);
const excluded = new Set(['auth.js', 'cloud.js']);
await cp(source, output, { recursive: true, filter: path => !excluded.has(basename(path)) });

async function rewrite(name, transform) {
  const path = join(output, name);
  await writeFile(path, transform(await readFile(path, 'utf8')));
}

function replaceRequired(text, pattern, replacement) {
  if (!text.match(pattern)) throw new Error(`Expected Pages build input: ${pattern}`);
  return text.replace(pattern, replacement);
}

await rewrite('index.html', text => [...excluded].reduce(
  (html, script) => replaceRequired(html, `<script src="${script}"></script>`, ''),
  replaceRequired(text, '个人空间 · 登录后同步', '公开本机版 · 数据仅保存在当前浏览器'),
));
await rewrite('extras.js', text => replaceRequired(text,
  /<h2>偏好与同步<\/h2>.*?<label class="field">外观/,
  '<h2>偏好</h2><p class="muted small">此版本不提供登录或云同步。</p><label class="field">外观',
));
await rewrite('app.js', text => replaceRequired(text, "'study-inbox-v1'", "'task-keeper-pages-v1'"));
await rewrite('manifest.webmanifest', text => `${JSON.stringify({ ...JSON.parse(text), id: './', start_url: './' })}\n`);

import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// The bundle has no files beside it, so its Content-Security-Policy allows
// exactly the inline script and style built here (by SHA-256), images from
// data: URLs, and nothing else: no other script, no network, no forms.
const hash = text => "'sha256-" + createHash('sha256').update(text, 'utf8').digest('base64') + "'";
const scriptHashes = [], styleHashes = [];

const root = new URL('./', import.meta.url);
const read = (file, encoding) => readFile(new URL('web/' + file, root), encoding);
// Git on Windows checks text files out with CRLF, but the HTML parser turns
// CRLF into LF before the browser hashes an inline block, so hash and embed
// the same LF text. Without this the CSP hashes would never match on Windows.
const readText = async file => (await read(file, 'utf8')).replace(/\r\n?/g, '\n');
let html = await readText('index.html');
const css = await readText('style.css');
const style = '\n' + css + '\n';
styleHashes.push(hash(style));
html = html.replace('<link rel="stylesheet" href="style.css">', () => '<style>' + style + '</style>');
// Keep the APK self-contained; Figma asset URLs never reach the runtime.
for (const file of await readdir(new URL('web/assets/', root))) {
  if (!file.endsWith('.svg')) continue;
  const bytes = await read('assets/' + file);
  if (!bytes.length) throw new Error('Empty asset: ' + file);
  html = html.replaceAll('assets/' + file, 'data:image/svg+xml;base64,' + bytes.toString('base64'));
}
for (const asset of ['cockpit', 'wheel', 'pedestrian']) {
  const bytes = await read(asset + '.webp');
  html = html.replace('</head>', () =>
    '<meta name="' + asset + '-asset" content="data:image/webp;base64,' + bytes.toString('base64') + '">\n</head>');
}
for (const file of ['drive.js', 'scene.js', 'input.js', 'defrost.js', 'app.js']) {
  const js = await readText(file);
  const body = '\n' + js.replace(/<\/script/gi, '<\\/script') + '\n';
  scriptHashes.push(hash(body));
  html = html.replace('<script src="' + file + '"></script>', () => '<script>' + body + '</script>');
}
const devPolicy = /<meta http-equiv="Content-Security-Policy" content="[^"]*">/;
if (!devPolicy.test(html)) throw new Error('web/index.html must keep its Content-Security-Policy meta tag');
const policy = ["default-src 'none'", 'script-src ' + scriptHashes.join(' '), 'style-src ' + styleHashes.join(' '),
  'img-src data:', "base-uri 'none'", "form-action 'none'"].join('; ');
html = html.replace(devPolicy, () => '<meta http-equiv="Content-Security-Policy" content="' + policy + '">');
await mkdir(new URL('dist/', root), {recursive:true});
await writeFile(new URL('dist/index.html', root), html);
console.log('Built dist/index.html (' + Buffer.byteLength(html) + ' bytes)');

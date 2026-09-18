const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');
const examplePath = path.join(__dirname, 'config.example.json');

let usingExample = false;
let file = configPath;
if (!fs.existsSync(configPath)) {
  file = examplePath;
  usingExample = true;
}

const config = JSON.parse(fs.readFileSync(file, 'utf-8'));

if (usingExample) {
  console.warn('⚠️  尚未建立 config.json，目前使用 config.example.json 的預設值（含預設管理員密碼）。');
  console.warn('⚠️  正式使用前請複製一份 config.example.json 為 config.json 並修改密碼與 SMTP 設定，或改用環境變數設定（見 README）。');
}

// 允許用「環境變數」覆蓋設定，適合部署到 Render / Railway 等雲端平台時使用
// （在平台的網頁後台設定，不需要把密碼寫進檔案或程式碼裡）。
// 本機用 config.json 的人可以完全忽略這一段，環境變數沒設定就不會有任何影響。
const env = process.env;
if (env.ADMIN_PASSWORD) config.adminPassword = env.ADMIN_PASSWORD;
if (env.PORT) config.port = parseInt(env.PORT, 10);
if (!config.smtp) config.smtp = {};
if (env.SMTP_ENABLED !== undefined) config.smtp.enabled = env.SMTP_ENABLED === 'true';
if (env.SMTP_HOST) config.smtp.host = env.SMTP_HOST;
if (env.SMTP_PORT) config.smtp.port = parseInt(env.SMTP_PORT, 10);
if (env.SMTP_SECURE !== undefined) config.smtp.secure = env.SMTP_SECURE === 'true';
if (env.SMTP_USER) config.smtp.user = env.SMTP_USER;
if (env.SMTP_PASS) config.smtp.pass = env.SMTP_PASS;
if (env.SMTP_FROM) config.smtp.from = env.SMTP_FROM;
if (env.SMTP_ADMIN_NOTIFY_EMAIL) config.smtp.adminNotifyEmail = env.SMTP_ADMIN_NOTIFY_EMAIL;

const DEFAULT_PLACEHOLDER_PASSWORD = '請改成你自己的管理員密碼';
if (config.adminPassword === DEFAULT_PLACEHOLDER_PASSWORD) {
  console.warn('🚨 警告：目前是預設管理員密碼，任何人都猜得到！請務必改成專屬密碼（config.json 或 ADMIN_PASSWORD 環境變數），尤其是部署到公開網路時。');
}

module.exports = config;

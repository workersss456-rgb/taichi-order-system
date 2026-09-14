const nodemailer = require('nodemailer');
const config = require('./config');

function getTransporter() {
  const smtp = config.smtp;
  if (!smtp || !smtp.enabled) return null;

  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: !!smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
}

async function notifyAdminOfSpecialRequest(request) {
  const smtp = config.smtp;
  const transporter = getTransporter();
  if (!transporter) {
    console.log('ℹ️  SMTP 尚未啟用（config.json 的 smtp.enabled 為 false），略過 email 通知。');
    return;
  }

  const html = `
    <h3>有一筆新的特殊設備採購申請，待審核</h3>
    <table border="1" cellpadding="6" cellspacing="0">
      <tr><td>申請人</td><td>${escapeHtml(request.requester_name)}</td></tr>
      <tr><td>職稱</td><td>${escapeHtml(request.title)}</td></tr>
      <tr><td>設備品名</td><td>${escapeHtml(request.item_name)}</td></tr>
      <tr><td>廠商</td><td>${escapeHtml(request.vendor || '-')}</td></tr>
      <tr><td>用途</td><td>${escapeHtml(request.purpose || '-')}</td></tr>
      <tr><td>預算</td><td>${escapeHtml(request.budget || '-')}</td></tr>
      <tr><td>數量</td><td>${request.quantity}</td></tr>
      <tr><td>備註</td><td>${escapeHtml(request.note || '-')}</td></tr>
      <tr><td>申請時間</td><td>${request.created_at}</td></tr>
    </table>
    <p>請登入管理後台審核此申請。</p>
  `;

  await transporter.sendMail({
    from: smtp.from,
    to: smtp.adminNotifyEmail,
    subject: `【叫料系統】新的特殊設備採購申請 - ${request.item_name}`,
    html,
  });
}

// ---------- 使用者註冊通知：管理員 ----------
async function notifyAdminOfRegistration(user) {
  const smtp = config.smtp;
  const transporter = getTransporter();
  if (!transporter) {
    console.log('ℹ️  SMTP 尚未啟用，略過註冊通知（管理員）。');
    return;
  }

  const html = `
    <h3>有新的使用者註冊 / 更新資料</h3>
    <table border="1" cellpadding="6" cellspacing="0">
      <tr><td>姓名</td><td>${escapeHtml(user.name)}</td></tr>
      <tr><td>職稱</td><td>${escapeHtml(user.title)}</td></tr>
      <tr><td>聯絡手機</td><td>${escapeHtml(user.phone)}</td></tr>
      <tr><td>Email</td><td>${escapeHtml(user.email || '-')}</td></tr>
      <tr><td>時間</td><td>${user.updated_at || user.created_at}</td></tr>
    </table>
  `;

  await transporter.sendMail({
    from: smtp.from,
    to: smtp.adminNotifyEmail,
    subject: `【叫料系統】新使用者註冊 - ${user.name}`,
    html,
  });
}

// ---------- 使用者註冊通知：使用者本人（沒有留 Email 就不寄） ----------
async function notifyUserOfRegistration(user) {
  if (!user.email || !user.email.trim()) {
    console.log(`ℹ️  ${user.name} 沒有留 Email，略過個人確認信。`);
    return;
  }
  const smtp = config.smtp;
  const transporter = getTransporter();
  if (!transporter) {
    console.log('ℹ️  SMTP 尚未啟用，略過註冊通知（使用者本人）。');
    return;
  }

  const html = `
    <p>${escapeHtml(user.name)} 您好，</p>
    <p>您的叫料系統帳號資料已建立／更新完成：</p>
    <table border="1" cellpadding="6" cellspacing="0">
      <tr><td>姓名</td><td>${escapeHtml(user.name)}</td></tr>
      <tr><td>職稱</td><td>${escapeHtml(user.title)}</td></tr>
      <tr><td>聯絡手機</td><td>${escapeHtml(user.phone)}</td></tr>
    </table>
    <p>之後在同一台裝置上會自動記住您的身份；若更換裝置，只要在登入畫面輸入同一組手機號碼即可帶回資料。</p>
  `;

  await transporter.sendMail({
    from: smtp.from,
    to: user.email.trim(),
    subject: `叫料系統 - 註冊成功通知`,
    html,
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

module.exports = {
  notifyAdminOfSpecialRequest,
  notifyAdminOfRegistration,
  notifyUserOfRegistration,
};

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
      <tr><td>部門</td><td>${escapeHtml(request.department)}</td></tr>
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

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

module.exports = { notifyAdminOfSpecialRequest };

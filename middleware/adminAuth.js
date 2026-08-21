const config = require('../config');

function requireAdmin(req, res, next) {
  // 密碼在前端會先用 encodeURIComponent 編碼過才放進 header，
  // 這裡要解碼回來比對，才能支援中文等非 ASCII 密碼。
  const raw = req.header('x-admin-password');
  let provided = '';
  try {
    provided = raw ? decodeURIComponent(raw) : '';
  } catch (e) {
    provided = raw || '';
  }
  if (!provided || provided !== config.adminPassword) {
    return res.status(401).json({ error: '管理員密碼錯誤或未提供' });
  }
  next();
}

module.exports = requireAdmin;

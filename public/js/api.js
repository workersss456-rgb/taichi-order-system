const Api = (() => {
  function adminHeaders() {
    const pw = sessionStorage.getItem('adminPassword');
    if (!pw) return {};
    return { 'x-admin-password': encodeURIComponent(pw) };
  }

  async function request(method, url, body, useAdmin) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    if (useAdmin) Object.assign(opts.headers, adminHeaders());

    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* 可能是空回應，例如 CSV */ }
    if (!res.ok) {
      const msg = (data && data.error) || `發生錯誤（${res.status}）`;
      throw new Error(msg);
    }
    return data;
  }

  return {
    get: (url, useAdmin) => request('GET', url, undefined, useAdmin),
    post: (url, body, useAdmin) => request('POST', url, body ?? {}, useAdmin),
    put: (url, body, useAdmin) => request('PUT', url, body ?? {}, useAdmin),
    del: (url, useAdmin) => request('DELETE', url, undefined, useAdmin),
    adminHeaders,
  };
})();

// Vercel Function 共通: エラー応答・メソッド制限・例外の握り方

export class HttpError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

/**
 * handler を包む。メソッドの許可リストを確認し、
 * HttpError は そのステータスで、それ以外は 500 で返す（内部の文言は外に出さない）。
 */
export function route(methods, handler) {
  return async (req, res) => {
    if (!methods.includes(req.method)) {
      res.setHeader('Allow', methods.join(', '));
      return send(res, 405, { error: 'Method not allowed' });
    }
    try {
      await handler(req, res);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error('[api]', req.method, req.url, e);
      return send(res, 500, { error: 'サーバーでエラーが起きました。時間をおいてもう一度お試しください。' });
    }
  };
}

export function body(req) {
  const b = req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string') {
    try { return JSON.parse(b); } catch { throw new HttpError(400, 'JSON の形式が正しくありません'); }
  }
  return {};
}

export function requireEnv(name, ...fallbacks) {
  for (const k of [name, ...fallbacks]) {
    const v = process.env[k]?.trim().replace(/^["']|["']$/g, '');
    if (v) return v;
  }
  throw new Error(`環境変数 ${name} が設定されていません`);
}

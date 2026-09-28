// Vercel AI Gateway（OpenAI Chat Completions 互換）の呼び出し
// tool calling ではなく response_format: json_object で記録を返させる（CLAUDE.md の方針）。
import { HttpError } from './http.js';

export const SYSTEM = `あなたは「AIコーチ」。ユーザー本人専用の健康・トレーニング記録アプリのアシスタントです。
役割は2つ。
1. メッセージや添付写真から記録すべきデータを抜き出して records に入れる
2. context（直近30日の記録とゴルフ履歴）を根拠に、具体的で短いアドバイスを reply に書く

次のJSONオブジェクトだけを返すこと（前置きやコードブロックは禁止）:
{"reply": string, "records": Record[], "suggestions": string[]}

Record = {
  "date": "YYYY-MM-DD",            // 「昨日」などは context.today から計算。未来日は不可
  "sleep_hours"?: number,
  "weight_kg"?: number,
  "body_photo"?: boolean,          // 添付写真が身体・体型の写真なら true
  "meals"?: [{"slot":"朝食"|"昼食"|"夕食"|"間食","name":string,"kcal":number,"p":number,"f":number,"c":number,"from_photo":boolean}],
  "training"?: [{"part":"胸"|"肩"|"腹筋"|"二頭"|"三頭"|"背中"|"下半身","name":string,"sets":[{"w":number,"r":number}]}],
  "golf_score"?: number
}

ルール:
- ユーザーが明示した値、または写真から推定できる値だけを記録する。睡眠や体重を推測で作らない。
- 既に context にある同じ食事・種目を、ユーザーが新しく送っていないのに二重に記録しない。
- 食事写真はメニューと量を推定して kcal と PFC(g) を出す。推定値であることを reply で一言添え、「ご飯は半分」のように直せると伝える。
- 食事の slot は文脈、なければ context.now_hour から決める（〜10時 朝食、〜15時 昼食、〜21時 夕食、それ以外 間食）。
- 「80kg 8回 3セット」は同じ値のセットを3つに展開する。自重種目の w は context の最新体重を使う。
- 種目の部位は7つのどれか1つ（主働筋）に割り当てる。
- 写真が食事か身体か判断できないときは records を空にして reply で聞く。
- 記録がなければ records は []。
- 記録の修正・削除を頼まれたら records は空にし、「ホームで該当の記録をタップすると編集・削除できます」と案内する。
- reply は日本語、自然な口調で300字以内。数値は context に基づき、無いことは断定しない。
- 医療的な診断・治療の指示はしない。痛み・体調不良・急な体重変化の相談には、無理をしないことと医療機関への相談をすすめる。
- suggestions は次にユーザーが送りそうな短い文を最大3つ。`;

const TIMEOUT_MS = 50_000;

/** 応答本文から JSON を取り出す。取り出せなければ reply だけの応答として扱う */
export function parseAiJson(text) {
  const s = String(text || '').replace(/```json|```/g, '').trim();
  try {
    const o = JSON.parse(s);
    if (o && typeof o === 'object') return o;
  } catch {
    const i = s.indexOf('{'), j = s.lastIndexOf('}');
    if (i >= 0 && j > i) { try { return JSON.parse(s.slice(i, j + 1)); } catch { /* fallthrough */ } }
  }
  return { reply: s, records: [] };
}

/**
 * @param messages Chat Completions 形式の messages（system を含む）
 * @param oidcToken Vercel 上では OIDC トークンで Gateway に認証できる（キー未設定でも動く）
 */
export async function callGateway(messages, { oidcToken } = {}) {
  const key = process.env.AI_GATEWAY_API_KEY?.trim() || oidcToken || process.env.VERCEL_OIDC_TOKEN;
  if (!key) throw new HttpError(503, 'AI の設定がされていません（AI_GATEWAY_API_KEY）');
  const base = (process.env.AI_GATEWAY_BASE_URL || 'https://ai-gateway.vercel.sh/v1').replace(/\/$/, '');

  let r;
  try {
    r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'openai/gpt-6-luna',
        messages,
        response_format: { type: 'json_object' },
        reasoning_effort: 'low',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    if (e?.name === 'TimeoutError') throw new HttpError(504, 'AI の応答が時間内に返りませんでした。もう一度送ってください。');
    throw new HttpError(502, 'AI に接続できませんでした。');
  }
  if (!r.ok) {
    console.error('[ai] gateway error', r.status, (await r.text()).slice(0, 500));
    throw new HttpError(502, r.status === 429 ? 'AI の利用が混み合っています。少し待ってから送ってください。' : 'AI からエラーが返りました。');
  }
  const data = await r.json();
  return parseAiJson(data.choices?.[0]?.message?.content || '{}');
}

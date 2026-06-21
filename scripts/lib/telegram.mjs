// Telegram Bot API adapter — для bootstrap-стадий.

async function api(token, method, params) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: params ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: params ? JSON.stringify(params) : undefined,
  });
  const data = await r.json();
  if (!data.ok) {
    throw new Error(`tg ${method}: ${data.description || JSON.stringify(data)}`);
  }
  return data.result;
}

export async function verifyBot(token) {
  const me = await api(token, 'getMe');
  if (!me.is_bot) throw new Error('not a bot');
}

export async function setWebhook(token, url) {
  await api(token, 'setWebhook', {
    url,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
}

export async function setMenuButton(token, button) {
  await api(token, 'setChatMenuButton', { menu_button: button });
}

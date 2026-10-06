// MyCal expert panel: experts follow their clients from a computer. Sign-in is approved from the
// app (experts sign in with Apple), then everything goes through the same coach RPCs the app uses,
// so the database enforces who sees what.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://kikpfpxqsjzrhvbqjgzi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PYU57YARhZwNYPgMmAgJMA_grG30WcY';
const LOGIN_FN = `${SUPABASE_URL}/functions/v1/expert-web-login`;

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, storageKey: 'mycal-expert' } });
const app = document.getElementById('app');
const who = document.getElementById('who');
const signoutBtn = document.getElementById('signout');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const n = (v, d = 0) => Number(v ?? 0).toLocaleString('tr-TR', { maximumFractionDigits: d });
const today = () => new Date().toLocaleDateString('sv-SE');
const MEALS = { breakfast: 'Kahvaltı', lunch: 'Öğle', dinner: 'Akşam', snack: 'Ara öğün' };
const STATUS = { on_track: 'Hedefte', over: 'Hedefin üstünde', low: 'Çok düşük', no_logs: 'Kayıt yok', in_progress: 'Devam ediyor' };

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data ?? [];
}

function post(body) {
  return fetch(LOGIN_FN, { method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
}

// Mirrors src/lib/adherence.ts.
function clientStatus(c, now = new Date()) {
  if (Number(c.today_entries) === 0) return 'no_logs';
  const target = Number(c.target_calories ?? 0);
  if (target <= 0) return 'in_progress';
  const ratio = c.today_calories / target;
  if (ratio > 1.15) return 'over';
  if (ratio >= 0.9 && ratio <= 1.05) return 'on_track';
  if (now.getHours() >= 19 && ratio < 0.6) return 'low';
  return 'in_progress';
}
const adherence = (c) => (c.target_calories > 0 ? Math.round((c.today_calories / c.target_calories) * 100) : 0);
const isRisky = (c) =>
  clientStatus(c) === 'over' ||
  (c.days_since_last_log ?? 99) >= 2 ||
  (c.diet_pace === 'strict' && c.target_calories > 0 && c.log_days_7d >= 3 && (c.avg_calories_7d ?? 0) > c.target_calories * 1.05);

function avatar(url, name) {
  const initial = (name ?? '?').trim().charAt(0).toLocaleUpperCase('tr-TR') || '?';
  return url ? `<img class="avatar" src="${esc(url)}" alt="">` : `<div class="avatar">${esc(initial)}</div>`;
}

// ---------- sign-in ----------
let pollTimer = null;
async function showLogin() {
  who.textContent = '';
  signoutBtn.hidden = true;
  clearInterval(pollTimer);
  app.innerHTML = `<section class="card" style="max-width:560px;margin:40px auto">
    <p class="eyebrow">UZMAN PANELİ</p>
    <h1 style="font-size:34px">Danışanlarını bilgisayardan takip et</h1>
    <p class="muted">Giriş, telefonundaki MyCal uygulamasından onaylanır; şifre gerekmez.</p>
    <div id="codebox" class="card" style="text-align:center;background:var(--surface)"><p class="muted">Kod hazırlanıyor…</p></div>
    <ol class="steps">
      <li>Telefonunda MyCal'ı aç, <b>Profil › Uzman paneli</b>'ne gir.</li>
      <li>Üstteki <b>bilgisayar</b> simgesine dokun.</li>
      <li>Ekrandaki kodu yaz ve onayla. Bu sayfa kendiliğinden açılır.</li>
    </ol>
    <p class="muted small">Kodu yalnızca kendi ekranında gördüysen onayla; başkasının gönderdiği kodu asla girme.</p>
  </section>`;
  const box = document.getElementById('codebox');
  const retry = (text, label) => {
    box.innerHTML = `<p>${text}</p><button class="btn sm" id="retry">${label}</button>`;
    document.getElementById('retry').onclick = showLogin;
  };
  let res = {};
  try {
    res = await post({ action: 'start' });
  } catch {
    // handled below
  }
  if (!res.code) return retry('Kod alınamadı.', 'Tekrar dene');

  const expiresAt = Date.now() + res.expires_in * 1000;
  box.innerHTML = `<div class="code">${res.code.slice(0, 4)} ${res.code.slice(4)}</div><p class="muted small" id="left"></p>`;
  const left = document.getElementById('left');
  pollTimer = setInterval(async () => {
    const secs = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    left.textContent = `Kodun süresi ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} sonra dolar`;
    let r;
    try {
      r = await post({ action: 'poll', code: res.code, secret: res.secret });
    } catch {
      return;
    }
    if (r.status === 'approved') {
      clearInterval(pollTimer);
      const { error } = await sb.auth.verifyOtp({ token_hash: r.token_hash, type: 'magiclink' });
      if (error) {
        toast('Giriş tamamlanamadı, tekrar dene.');
        showLogin();
      }
    } else if (r.status === 'expired' || secs === 0) {
      clearInterval(pollTimer);
      retry('Kodun süresi doldu.', 'Yeni kod al');
    } else if (r.status === 'no_email') {
      clearInterval(pollTimer);
      box.innerHTML = `<p>Hesabında e-posta olmadığı için web girişi yapılamıyor.</p>`;
    }
  }, 2000);
}

// ---------- dashboard ----------
const state = { tab: 'clients', filter: 'all', clients: [], plates: [], requests: [], profile: null, selected: null, date: today() };

async function loadAll() {
  const [profile, clients, plates, requests] = await Promise.all([
    rpc('coach_get_or_create_profile').then((r) => r[0] ?? null),
    rpc('coach_get_clients'),
    rpc('coach_get_pending_plates'),
    rpc('coach_get_requests'),
  ]);
  Object.assign(state, { profile, clients, plates, requests });
}

async function showDashboard(session) {
  clearInterval(pollTimer);
  signoutBtn.hidden = false;
  const { data: prof } = await sb.from('profiles').select('display_name').eq('id', session.user.id).maybeSingle();
  who.textContent = prof?.display_name ?? '';
  app.innerHTML = `<p class="muted">Danışanlar yükleniyor…</p>`;
  try {
    await loadAll();
  } catch (e) {
    const pro = String(e?.message ?? '').includes('coach_pro_required');
    app.innerHTML = `<section class="card" style="max-width:560px;margin:40px auto"><h2>${pro ? 'Uzman Pro gerekli' : 'Bir sorun oluştu'}</h2>
      <p class="muted">${pro ? 'Panel, MyCal Uzman Pro aboneliği olan uzmanlar içindir. Aboneliği uygulamadan başlatabilirsin.' : 'Sayfayı yenileyip tekrar dene.'}</p></section>`;
    return;
  }
  render();
}

async function refresh() {
  try {
    await loadAll();
  } catch {
    toast('Yenilenemedi');
  }
  render();
}

function render() {
  const { clients, plates, requests, profile } = state;
  const avg = clients.length ? Math.round(clients.reduce((s, c) => s + adherence(c), 0) / clients.length) : 0;
  const list = clients.filter((c) =>
    state.filter === 'risky' ? isRisky(c) : state.filter === 'no_logs' ? (c.days_since_last_log ?? 99) >= 2 : true
  );
  app.innerHTML = `
  <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:8px">
    <div><p class="eyebrow">UZMAN PANELİ</p><h1 style="font-size:32px;margin:0">Bugün</h1></div>
    <div class="sub">Davet kodun: <b style="color:var(--text);letter-spacing:1px">${esc(profile?.invite_code ?? '—')}</b>
      <button class="btn tonal sm" id="copy" style="margin-left:6px">Kopyala</button></div>
  </div>
  <div class="stats">
    <div class="stat"><b>${clients.length}</b><span>Danışan</span></div>
    <div class="stat"><b style="color:var(--primary)">%${avg}</b><span>Ortalama uyum</span></div>
    <div class="stat"><b>${plates.length + requests.length}</b><span>Bekleyen</span></div>
  </div>
  <div class="tabs">
    ${[['clients', 'Danışanlar'], ['plates', `Tabaklar (${plates.length})`], ['requests', `Talepler (${requests.length})`]]
      .map(([k, l]) => `<button class="chip ${state.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}
    <button class="chip" id="refresh" aria-label="Yenile">↻ Yenile</button>
  </div>
  <div id="body"></div>`;
  document.getElementById('copy').onclick = () => navigator.clipboard?.writeText(profile?.invite_code ?? '').then(() => toast('Davet kodu kopyalandı'));
  document.getElementById('refresh').onclick = refresh;
  app.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; render(); }));
  const body = document.getElementById('body');
  if (state.tab === 'plates') return renderPlates(body);
  if (state.tab === 'requests') return renderRequests(body);

  body.innerHTML = `<div class="panel">
    <div>
      <div class="tabs">${[['all', 'Tümü'], ['risky', 'Riskli'], ['no_logs', '2+ gün kayıtsız']]
        .map(([k, l]) => `<button class="chip ${state.filter === k ? 'on' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>
      ${list.length ? list.map((c) => {
        const s = clientStatus(c);
        return `<button class="row ${state.selected === c.client_id ? 'sel' : ''}" data-client="${c.client_id}">
          ${avatar(c.avatar_url, c.display_name)}
          <div class="grow"><div class="name">${esc(c.display_name ?? 'İsimsiz')}</div>
          <div class="sub">${n(c.today_calories)} / ${n(c.target_calories)} kcal</div></div>
          <span class="pill s-${s}">${STATUS[s]}</span></button>`;
      }).join('') : `<p class="empty">${clients.length ? 'Bu filtrede danışan yok.' : 'Henüz danışanın yok. Davet kodunu paylaşarak başla.'}</p>`}
    </div>
    <div id="detail">${clients.length ? '<p class="empty">Ayrıntıları görmek için bir danışan seç.</p>' : ''}</div>
  </div>`;
  body.querySelectorAll('[data-filter]').forEach((b) => (b.onclick = () => { state.filter = b.dataset.filter; render(); }));
  body.querySelectorAll('[data-client]').forEach((b) => (b.onclick = () => { state.selected = b.dataset.client; render(); }));
  if (state.selected && clients.some((c) => c.client_id === state.selected)) renderDetail(document.getElementById('detail'));
}

async function signed(bucket, paths) {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length) return {};
  const { data } = await sb.storage.from(bucket).createSignedUrls(list, 600);
  return Object.fromEntries((data ?? []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
}

function renderDetail(el) {
  const c = state.clients.find((x) => x.client_id === state.selected);
  const weekly = c.weekly_weight_change != null ? ` · haftalık ${c.weekly_weight_change > 0 ? '+' : ''}${n(c.weekly_weight_change, 1)} kg` : '';
  el.innerHTML = `<section class="card" style="margin-top:0">
    <div style="display:flex;gap:12px;align-items:center">${avatar(c.avatar_url, c.display_name)}
      <div class="grow"><h2 style="margin:0">${esc(c.display_name ?? 'İsimsiz')}</h2>
      <div class="sub">${c.weight_kg ? `${n(c.weight_kg, 1)} kg · ` : ''}7 günde ${n(c.log_days_7d)} gün kayıt · ort. ${n(c.avg_calories_7d)} kcal${weekly}</div></div></div>
    <div style="display:flex;align-items:center;gap:8px;margin-top:16px"><h3 style="margin:0;flex:1">Günlük</h3>
      <input type="date" id="date" value="${state.date}" max="${today()}" class="field" style="height:40px;width:auto;border-radius:12px" aria-label="Tarih"></div>
    <div id="entries"><p class="muted">Yükleniyor…</p></div>
    <h3>Hedef ata</h3>
    <form id="goal" class="form">
      <label>Kalori<input name="calories" type="number" min="1000" max="6000" value="${Math.round(c.target_calories ?? 0) || ''}" required></label>
      <label>Protein (g)<input name="protein_g" type="number" min="0" max="400" value="${Math.round(c.target_protein_g ?? 0) || ''}" required></label>
      <label>Karbonhidrat (g)<input name="carbs_g" type="number" min="0" max="800" required></label>
      <label>Yağ (g)<input name="fat_g" type="number" min="0" max="300" required></label>
      <label style="grid-column:1/-1">Not (isteğe bağlı)<textarea name="note" maxlength="500"></textarea></label>
      <div style="grid-column:1/-1"><button class="btn sm" type="submit">Hedefi gönder</button></div>
    </form>
    <h3>Haftalık check-in'ler</h3>
    <div id="checkins"><p class="muted">Yükleniyor…</p></div>
  </section>`;
  document.getElementById('date').onchange = (e) => { state.date = e.target.value; loadEntries(c); };
  document.getElementById('goal').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const weekday = { calories: +f.calories, protein_g: +f.protein_g, carbs_g: +f.carbs_g, fat_g: +f.fat_g };
    try {
      await rpc('coach_assign_protocol', { p_client: c.client_id, p_weekday: weekday, p_weekend: null, p_note: f.note?.trim() || null });
      toast('Hedef gönderildi');
      refresh();
    } catch (err) {
      toast(String(err?.message ?? '').includes('invalid_targets') ? 'Hedef değerleri geçersiz' : 'Gönderilemedi');
    }
  };
  loadEntries(c);
  loadCheckins(c);
}

async function loadEntries(c) {
  const el = document.getElementById('entries');
  try {
    const rows = await rpc('coach_get_client_entries', { p_client: c.client_id, p_date: state.date });
    if (!rows.length) {
      el.innerHTML = `<p class="empty">Bu gün için kayıt yok.</p>`;
      return;
    }
    const tot = rows.reduce((a, r) => ({ k: a.k + +r.calories, p: a.p + +r.protein_g, c: a.c + +r.carbs_g, f: a.f + +r.fat_g }), { k: 0, p: 0, c: 0, f: 0 });
    const verdict = (r) =>
      r.review_verdict ? ` <span class="pill ${r.review_verdict === 'approved' ? 's-on_track' : 's-no_logs'}">${r.review_verdict === 'approved' ? 'Onaylandı' : 'Not bırakıldı'}</span>` : '';
    el.innerHTML = `<div style="overflow-x:auto"><table><thead><tr><th>Öğün</th><th>Yiyecek</th><th class="num">kcal</th><th class="num">P</th><th class="num">K</th><th class="num">Y</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${MEALS[r.meal_type] ?? esc(r.meal_type)}</td><td>${esc(r.food_name ?? '—')}${verdict(r)}</td>
        <td class="num">${n(r.calories)}</td><td class="num">${n(r.protein_g)}</td><td class="num">${n(r.carbs_g)}</td><td class="num">${n(r.fat_g)}</td></tr>`).join('')}
      <tr><th colspan="2">Toplam</th><th class="num">${n(tot.k)}</th><th class="num">${n(tot.p)}</th><th class="num">${n(tot.c)}</th><th class="num">${n(tot.f)}</th></tr></tbody></table></div>`;
  } catch {
    el.innerHTML = `<p class="empty">Kayıtlar yüklenemedi.</p>`;
  }
}

async function loadCheckins(c) {
  const el = document.getElementById('checkins');
  try {
    const rows = await rpc('coach_get_checkins', { p_client: c.client_id });
    if (!rows.length) {
      el.innerHTML = `<p class="empty">Henüz check-in yok.</p>`;
      return;
    }
    const urls = await signed('progress-photos', rows.flatMap((r) => r.photo_paths ?? []));
    el.innerHTML = rows.map((r) => `<div class="card" style="margin:8px 0;padding:16px">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${new Date(r.week_start).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })} haftası</b>
      <span class="sub">${r.weight_kg ? `${n(r.weight_kg, 1)} kg` : ''}${r.waist_cm ? ` · bel ${n(r.waist_cm, 1)} cm` : ''}</span></div>
      ${(r.photo_paths ?? []).length ? `<div style="display:flex;gap:8px;margin-top:10px">${r.photo_paths.map((p) => (urls[p] ? `<a href="${esc(urls[p])}" target="_blank" rel="noopener"><img class="thumb" src="${esc(urls[p])}" alt="İlerleme fotoğrafı"></a>` : '')).join('')}</div>` : ''}
      ${r.coach_feedback
        ? `<p class="sub" style="margin:10px 0 0">Geri bildirimin: ${esc(r.coach_feedback)}</p>`
        : `<form data-checkin="${r.id}" style="margin-top:10px;display:grid;gap:8px"><textarea name="text" maxlength="1000" placeholder="Geri bildirim yaz" required></textarea><div><button class="btn sm" type="submit">Gönder</button></div></form>`}
    </div>`).join('');
    el.querySelectorAll('[data-checkin]').forEach((form) => (form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await rpc('coach_give_checkin_feedback', { p_checkin: form.dataset.checkin, p_text: String(new FormData(form).get('text')).trim() });
        toast('Geri bildirim gönderildi');
        loadCheckins(c);
      } catch {
        toast('Gönderilemedi');
      }
    }));
  } catch {
    el.innerHTML = `<p class="empty">Check-in'ler yüklenemedi.</p>`;
  }
}

async function renderPlates(body) {
  if (!state.plates.length) {
    body.innerHTML = `<p class="empty">İncelenecek tabak yok.</p>`;
    return;
  }
  const urls = await signed('meal-photos', state.plates.map((p) => p.photo_url));
  body.innerHTML = state.plates.map((p) => `<div class="row" style="cursor:default;flex-wrap:wrap">
    ${urls[p.photo_url] ? `<img class="thumb" src="${esc(urls[p.photo_url])}" alt="">` : avatar(p.client_avatar, p.client_name)}
    <div class="grow"><div class="name">${esc(p.food_name ?? '—')}</div>
      <div class="sub">${esc(p.client_name ?? 'İsimsiz')} · ${MEALS[p.meal_type] ?? ''} · ${n(p.calories)} kcal · P ${n(p.protein_g)} K ${n(p.carbs_g)} Y ${n(p.fat_g)}</div></div>
    <div class="actions"><button class="btn sm" data-ok="${p.entry_id}">Onayla</button><button class="btn tonal sm" data-warn="${p.entry_id}">Not bırak</button></div></div>`).join('');
  const review = async (id, verdict, note) => {
    try {
      await rpc('coach_review_plate', { p_entry: id, p_verdict: verdict, p_note: note });
      toast(verdict === 'approved' ? 'Tabak onaylandı' : 'Not gönderildi');
      refresh();
    } catch {
      toast('Gönderilemedi');
    }
  };
  body.querySelectorAll('[data-ok]').forEach((b) => (b.onclick = () => review(b.dataset.ok, 'approved', null)));
  body.querySelectorAll('[data-warn]').forEach((b) => (b.onclick = () => {
    const note = prompt('Danışanına notun:');
    if (note && note.trim()) review(b.dataset.warn, 'warning', note.trim().slice(0, 500));
  }));
}

function renderRequests(body) {
  if (!state.requests.length) {
    body.innerHTML = `<p class="empty">Bekleyen talep yok.</p>`;
    return;
  }
  body.innerHTML = state.requests.map((r) => `<div class="row" style="cursor:default;align-items:flex-start;flex-wrap:wrap">
    ${avatar(r.avatar_url, r.display_name)}
    <div class="grow"><div class="name">${esc(r.display_name ?? 'İsimsiz')}</div>
      ${r.package_title ? `<div class="sub">${esc(r.package_title)}${r.package_price ? ` · ₺${n(r.package_price)}` : ''}${r.payment_declared ? ` · ödeme bildirildi (${esc(r.reference ?? '')})` : ''}</div>` : ''}
      ${r.message ? `<p style="margin:6px 0 0">${esc(r.message)}</p>` : ''}</div>
    <div class="actions"><button class="btn sm" data-accept="${r.request_id}">Kabul et</button><button class="btn tonal sm" data-decline="${r.request_id}">Reddet</button></div></div>`).join('');
  const answer = async (id, accept) => {
    try {
      await rpc('respond_coaching_request', { p_request: id, p_accept: accept });
      toast(accept ? 'Talep kabul edildi' : 'Talep reddedildi');
      refresh();
    } catch (err) {
      toast(String(err?.message ?? '').includes('coach_full') ? 'Kapasiten dolu' : 'İşlem yapılamadı');
    }
  };
  body.querySelectorAll('[data-accept]').forEach((b) => (b.onclick = () => answer(b.dataset.accept, true)));
  body.querySelectorAll('[data-decline]').forEach((b) => (b.onclick = () => answer(b.dataset.decline, false)));
}

signoutBtn.onclick = () => sb.auth.signOut();

let current;
sb.auth.onAuthStateChange((_event, session) => {
  const id = session?.user?.id ?? null;
  if (id === current) return;
  current = id;
  // Defer: supabase-js warns against awaiting its own calls inside this callback.
  setTimeout(() => (session ? showDashboard(session) : showLogin()), 0);
});

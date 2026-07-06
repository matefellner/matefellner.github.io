import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { pickOfDay, todayStr } from './pick.mjs';
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY, NAMES } from './config.js';

const $ = id => document.getElementById(id);

if (!SUPABASE_URL) {
  document.body.innerHTML = '<p style="padding:2em">config.js nincs kitöltve — lásd README.</p>';
  throw new Error('config.js empty');
}

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- helpers ---------------------------------------------------------------
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
}

const renderers = {}; // view name -> render fn; Ma/Emlékek register here later

function show(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $(name).classList.remove('hidden');
  $('nav').classList.toggle('hidden', name === 'login');
  document.querySelectorAll('nav button')
    .forEach(b => b.classList.toggle('active', b.dataset.view === name));
  renderers[name]?.();
}

// --- data ------------------------------------------------------------------
let memories = JSON.parse(localStorage.getItem('memories') || '[]');

async function refresh() {
  const { data, error } = await sb.from('memories')
    .select('*').order('date', { ascending: false });
  if (!error && data) {
    memories = data;
    localStorage.setItem('memories', JSON.stringify(data));
  }
  return memories; // on error: stale cache, better than nothing
}

// --- auth + boot -------------------------------------------------------------
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { show('login'); return; }
  await refresh();
  enablePush();
  show('ma');
}

$('loginBtn').onclick = async () => {
  const { error } = await sb.auth.signInWithPassword(
    { email: $('email').value.trim(), password: $('password').value });
  if (error) return toast('Sikertelen belépés');
  boot();
};
$('password').onkeydown = e => { if (e.key === 'Enter') $('loginBtn').click(); };

document.querySelectorAll('nav button')
  .forEach(b => b.onclick = () => show(b.dataset.view));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
boot();

// --- új emlék ----------------------------------------------------------------
async function resizeImage(file, maxDim = 1600) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
}

$('newDate').value = todayStr();

$('newPhoto').onchange = () => {
  const f = $('newPhoto').files[0];
  if (f) { $('preview').src = URL.createObjectURL(f); $('preview').classList.remove('hidden'); }
};

$('saveBtn').onclick = async () => {
  const date = $('newDate').value, text = $('newText').value.trim(), file = $('newPhoto').files[0];
  if (!date || !text || !file) return toast('Dátum, szöveg és kép is kell!');
  $('saveBtn').disabled = true;
  try {
    const blob = await resizeImage(file);
    const path = `${date}_${crypto.randomUUID().slice(0, 8)}.jpg`;
    let r = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
    if (r.error) throw r.error;
    r = await sb.from('memories').insert({ date, text, image_path: path });
    if (r.error) throw r.error;
    toast('Emlék elmentve!');
    $('newText').value = ''; $('newPhoto').value = '';
    $('preview').classList.add('hidden');
    await refresh();
    show('ma');
  } catch (e) {
    console.error(e);
    toast('Hiba a mentésnél, próbáld újra'); // form keeps its content
  } finally {
    $('saveBtn').disabled = false;
  }
};

// --- ma ----------------------------------------------------------------------
async function photoUrl(path) {
  const { data } = await sb.storage.from('photos').createSignedUrl(path, 3600);
  return data?.signedUrl;
}

let currentId = null;

async function renderMa(id) {
  if (!memories.length) {
    $('maText').textContent = 'Még nincs emlék — hozz létre egyet!';
    $('maImg').removeAttribute('src');
    $('maDate').textContent = ''; $('maAuthor').textContent = '';
    return;
  }
  currentId = id ?? pickOfDay(memories.map(m => m.id).sort((a, b) => a - b), todayStr());
  const m = memories.find(x => x.id === currentId);
  $('maDate').textContent = m.date;
  $('maText').textContent = m.text;
  $('maAuthor').textContent = NAMES[m.author_id] || '';
  try { $('maImg').src = (await photoUrl(m.image_path)) || ''; }
  catch { /* offline: text still shows */ }
}

renderers.ma = () => renderMa();

$('rerollBtn').onclick = () => {
  const others = memories.filter(m => m.id !== currentId);
  const m = others[Math.floor(Math.random() * others.length)] || memories[0];
  if (m) renderMa(m.id);
};

// --- emlékek (lista) -----------------------------------------------------------
async function renderList() {
  const el = $('lista');
  el.textContent = '';
  if (!memories.length) { el.textContent = 'Még nincs emlék.'; return; }
  let urls = {};
  try {
    const { data } = await sb.storage.from('photos')
      .createSignedUrls(memories.map(m => m.image_path), 3600);
    urls = Object.fromEntries((data || []).map(u => [u.path, u.signedUrl]));
  } catch { /* offline: cards without photos */ }
  for (const m of memories) { // memories already newest-first from refresh()
    const card = document.createElement('div');
    card.className = 'card';
    const img = document.createElement('img');
    img.loading = 'lazy';
    if (urls[m.image_path]) img.src = urls[m.image_path];
    const meta = document.createElement('div');
    const date = document.createElement('div');
    date.className = 'date';
    date.textContent = `${m.date} — ${NAMES[m.author_id] || ''}`;
    const p = document.createElement('p');
    p.textContent = m.text;
    meta.append(date, p);
    card.append(img, meta);
    el.appendChild(card);
  }
}

renderers.lista = renderList;

// --- push --------------------------------------------------------------------
function b64ToU8(s) {
  const pad = '='.repeat((4 - s.length % 4) % 4);
  const b = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}

async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID_PUBLIC_KEY) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (await Notification.requestPermission() !== 'granted') return;
    const sub = await reg.pushManager.getSubscription()
      || await reg.pushManager.subscribe({
           userVisibleOnly: true,
           applicationServerKey: b64ToU8(VAPID_PUBLIC_KEY),
         });
    const { data: { user } } = await sb.auth.getUser();
    await sb.from('push_subscriptions')
      .upsert({ user_id: user.id, subscription: sub.toJSON() }, { onConflict: 'user_id' });
  } catch (e) {
    console.error('push setup:', e); // non-fatal: app works without push
  }
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get, insert, openDb, update, type Row, type User } from '../src/server/db.ts';
import { hashPassword } from '../src/server/app.ts';
import { seedDemo } from '../src/server/seed.ts';
import { applyImport, buildPrompt, canUse, createExport, parseProfileLink, previewImport, SCHEMA_VERSION, undoImport } from '../src/server/chatgpt.ts';
import { creatorStats } from '../src/server/domain.ts';

process.env.HQ_TODAY = '2026-10-12';
const db = openDb(':memory:');
insert(db, 'users', { name: 'Founder', email: 'f@test.in', role: 'founder', status: 'active', password_hash: hashPassword('founder-password') });
seedDemo(db);
const userBy = (email: string) => get(db, `SELECT id, name, email, role, editor_id, influencer_id, brand_id FROM users WHERE email = ?`, email) as User;
const founder = userBy('f@test.in');
const pkgOf = (key: string) => JSON.parse(get(db, 'SELECT package FROM ai_exports WHERE export_key = ?', key)!.package);

function result(key: string, profiles: Row[], extra: Row = {}) {
  const p = pkgOf(key);
  return {
    schema_version: SCHEMA_VERSION, analysis_type: 'creator_profile', export_id: key, result_id: `${key}-r${Math.random().toString(36).slice(2, 6)}`, generated_at: '2026-10-12T10:00:00Z',
    reporting_period: p.reporting_period, record_ids: [], source_record_versions: p.source_record_versions, provenance: [{ source: 'ChatGPT browsing', kind: 'user_provided', retrieved_at: '2026-10-12T09:00:00Z', notes: null }],
    summary: 'Profiles read from public pages', website_facts: [], connector_metrics: [], derived_calculations: [], observations: [], recommendations: [], proposed_tasks: [], proposed_changes: [],
    missing_data: [], assumptions: [], limitations: [], profiles, ...extra,
  };
}
const posts = (platform: string, base: string, views: number[]) => views.map((v, i) => ({ platform, url: `${base}${i}/`, published_at: `2026-10-${String(10 - i).padStart(2, '0')}T12:00:00Z`, format: platform === 'youtube' ? 'video' : 'reel', topic: 'Street food', duration_sec: 40, promotion: i === 0 ? 'paid' : 'unknown', views: v, likes: Math.round(v / 20), comments: null }));
const profile = (extra: Row): Row => ({
  record: null, link: 'https://www.instagram.com/newfoodie/', status: 'retrieved', source: 'Instagram public profile (ChatGPT browsing)', retrieved_at: '2026-10-12T09:00:00Z',
  name: 'Naina Foodie', handle: '@newfoodie', bio: 'Delhi street food • collabs: naina@foodie.example', city: 'Delhi', state: 'Delhi', email: 'naina@foodie.example',
  languages: ['Hindi', 'English'], categories: ['food', 'travel'], inferred_fields: ['categories'],
  platforms: [{ platform: 'instagram', username: 'newfoodie', profile_url: 'https://www.instagram.com/newfoodie/', followers: 154000, posts_count: 410 }, { platform: 'youtube', username: 'newfoodie', profile_url: 'https://www.youtube.com/@newfoodie', followers: 32000, posts_count: 90 }],
  recent_content: [...posts('instagram', 'https://www.instagram.com/reel/nf', [900000, 40000, 50000, 60000, 70000]), ...posts('youtube', 'https://www.youtube.com/watch?v=nf', [99000, 15000, 18000, 12000])],
  issues: ['Counts are rounded as displayed'], ...extra,
});

test('profile links: parsed, and matched to a creator only on an exact handle', () => {
  assert.deepEqual(parseProfileLink('https://www.instagram.com/RiyaGlows/?hl=en'), { link: 'https://www.instagram.com/RiyaGlows/?hl=en', platform: 'instagram', handle: 'riyaglows' });
  assert.equal(parseProfileLink('https://youtube.com/@kabircooks').handle, 'kabircooks');
  assert.equal(parseProfileLink('https://www.instagram.com/reel/abc/').handle, null);
  assert.throws(() => parseProfileLink('javascript:alert(1)'), /not a web link/);
  const key = createExport(db, founder, { type: 'creator_profile', links: ['https://www.instagram.com/riyaglows/', 'https://www.instagram.com/newfoodie/'] });
  const p = pkgOf(key);
  assert.equal(p.links[0].matched, `influencers:${get(db, `SELECT id FROM influencers WHERE handle = '@riyaglows'`)!.id}`);
  assert.equal(p.links[1].matched, null);
  assert.ok(p.records.influencers.some((i: Row) => i.handle === '@riyaglows'), 'matched creator included for refresh');
  assert.ok(p.response_schema.properties.profiles);
  const prompt = buildPrompt({ ...get(db, 'SELECT * FROM ai_exports WHERE export_key = ?', key), package: p }, 'connector');
  assert.match(prompt, /screenshots/);
  assert.match(prompt, /12 most recent posts\/videos/);
  assert.match(prompt, /Never estimate or invent/);
  assert.throws(() => createExport(db, founder, { type: 'creator_profile' }), /Paste at least one profile link/);
  assert.equal(canUse(userBy('aditya@demo.socialmog.in'), 'creator_profile'), false, 'campaign managers cannot change creator profiles');
  assert.equal(canUse(userBy('sana@demo.socialmog.in'), 'creator_profile'), true);
});

test('new creator from a link: profile, both channels and recent videos saved; roster average views follow; undo removes it all', () => {
  const key = createExport(db, founder, { type: 'creator_profile', links: ['https://www.instagram.com/newfoodie/'] });
  const pv = previewImport(db, founder, JSON.stringify(result(key, [profile({})])));
  const pr = pv.profiles[0];
  assert.equal(pr.resolved, null);
  assert.equal(pr.possible_matches.length, 0);
  assert.equal(pr.fields.find((f: Row) => f.key === 'categories').inferred, true);
  assert.deepEqual(pr.saved_posts, []);
  assert.equal(pr.content.filter((c: Row) => c.usable).length, 9);
  const out = applyImport(db, founder, pv.import_id, { profiles: [{ index: 0 }] });
  const created = out.applied.find((a: Row) => a.kind === 'create')!;
  const inf = get(db, 'SELECT * FROM influencers WHERE id = ?', created.id)!;
  assert.equal(inf.name, 'Naina Foodie');
  assert.equal(inf.handle, '@newfoodie');
  assert.equal(inf.relationship, 'prospect');
  assert.deepEqual(JSON.parse(inf.niches), ['food', 'travel']);
  const plats = JSON.parse(inf.platforms);
  assert.equal(plats.length, 2);
  assert.equal(plats.find((p: Row) => p.platform === 'youtube').url, 'https://www.youtube.com/@newfoodie');
  assert.match(plats[0].source, /ChatGPT profile import: Instagram public profile .*user-imported/);
  assert.equal(get(db, 'SELECT COUNT(*) n FROM posts WHERE influencer_id = ? AND archived_at IS NULL', created.id)!.n, 9);
  const stats = creatorStats(db, [created.id], { commercials: false }).get(created.id)!;
  assert.equal(stats.platforms.find((p: Row) => p.platform === 'instagram').avg_views, 55000);
  assert.equal(stats.platforms.find((p: Row) => p.platform === 'youtube').avg_views, 15000);
  undoImport(db, founder, pv.import_id, 'Wrong creator');
  assert.ok(get(db, 'SELECT archived_at FROM influencers WHERE id = ?', created.id)!.archived_at);
  assert.equal(get(db, 'SELECT COUNT(*) n FROM posts WHERE influencer_id = ? AND archived_at IS NULL', created.id)!.n, 0);
});

test('existing creator: never merged by guesswork; refresh updates channels with provenance and is undoable', () => {
  const riya = get(db, `SELECT * FROM influencers WHERE handle = '@riyaglows'`)!;
  // A "new" profile whose handle already exists must be decided by the user.
  const k1 = createExport(db, founder, { type: 'creator_profile', links: ['https://www.instagram.com/someoneelse/'] });
  const dup = previewImport(db, founder, JSON.stringify(result(k1, [profile({ handle: '@riyaglows', name: 'Riya S', platforms: [{ platform: 'instagram', username: 'riyaglows', profile_url: 'https://www.instagram.com/riyaglows/', followers: 430000, posts_count: null }], recent_content: [] })])));
  assert.equal(dup.profiles[0].possible_matches[0].label, 'Riya Sharma');
  assert.throws(() => applyImport(db, founder, dup.import_id, { profiles: [{ index: 0 }] }), /may already be Riya Sharma/);

  // Refresh the existing creator from her package reference.
  const k2 = createExport(db, founder, { type: 'creator_profile', ids: [riya.id] });
  const before = JSON.parse(riya.platforms);
  const pv = previewImport(db, founder, JSON.stringify(result(k2, [profile({
    record: `influencers:${riya.id}`, link: 'https://www.instagram.com/riyaglows/', name: 'Riya Sharma', handle: '@riyaglows', city: 'Mumbai', state: 'Maharashtra', email: null, categories: ['beauty', 'skincare'], inferred_fields: [],
    platforms: [{ platform: 'instagram', username: 'riyaglows', profile_url: 'https://www.instagram.com/riyaglows/', followers: 431000, posts_count: null }],
    recent_content: [...posts('instagram', 'https://www.instagram.com/reel/rs', [100000, 120000, 130000]), { platform: 'instagram', url: 'javascript:alert(1)', published_at: '2026-10-01T10:00:00Z', format: 'reel', topic: null, duration_sec: null, promotion: 'unknown', views: 5, likes: null, comments: null }],
  })])));
  const pr = pv.profiles[0];
  assert.equal(pr.resolved.label, 'Riya Sharma');
  assert.equal(pr.platforms[0].current_followers, before[0].followers);
  assert.equal(pr.content.filter((c: Row) => c.usable).length, 3, 'non-web links are never saved');
  assert.ok(!pr.fields.some((f: Row) => f.key === 'email'), 'nothing proposed for missing values');
  applyImport(db, founder, pv.import_id, { profiles: [{ index: 0, fields: ['city'] }] });
  const after = JSON.parse(get(db, 'SELECT platforms FROM influencers WHERE id = ?', riya.id)!.platforms);
  assert.equal(after[0].followers, 431000);
  assert.equal(after[0].updated_at, '2026-10-12');
  assert.match(after[0].source, /ChatGPT profile import/);
  assert.equal(get(db, `SELECT COUNT(*) n FROM posts WHERE influencer_id = ? AND permalink LIKE 'https://www.instagram.com/reel/rs%'`, riya.id)!.n, 3);
  undoImport(db, founder, pv.import_id, 'check');
  assert.deepEqual(JSON.parse(get(db, 'SELECT platforms FROM influencers WHERE id = ?', riya.id)!.platforms), before, 'previous channel figures restored');

  // Failed retrievals cannot be applied.
  const k3 = createExport(db, founder, { type: 'creator_profile', links: ['https://www.instagram.com/privateacct/'] });
  const failed = previewImport(db, founder, JSON.stringify(result(k3, [profile({ link: 'https://www.instagram.com/privateacct/', handle: '@privateacct', status: 'failed', platforms: [], recent_content: [], issues: ['Login required'] })])));
  assert.throws(() => applyImport(db, founder, failed.import_id, { profiles: [{ index: 0 }] }), /could not be retrieved/);
});

test('links: the same profile pasted twice is one link; matched only on the same platform; package leaves private notes out', () => {
  const key = createExport(db, founder, { type: 'creator_profile', links: ['https://www.instagram.com/NewChef/?hl=en', 'https://instagram.com/newchef', 'https://m.instagram.com/newchef/#top'] });
  assert.equal(pkgOf(key).links.length, 1);
  // A YouTube-only creator using @kidchef is not the Instagram account @kidchef.
  const yt = insert(db, 'influencers', { name: 'Aarav Cooks', handle: '@aaravcooks', relationship: 'prospect', platforms: [{ platform: 'youtube', handle: '@kidchef', url: 'https://youtube.com/channel/UCabc123', followers: 1000 }] });
  const links = pkgOf(createExport(db, founder, { type: 'creator_profile', links: ['https://www.instagram.com/kidchef/', 'https://www.youtube.com/channel/UCabc123'] })).links;
  assert.equal(links[0].matched, null, 'an Instagram link is never matched to a YouTube channel');
  assert.equal(links[1].matched, `influencers:${yt}`, 'same channel link matched despite www.');
  const riya = get(db, `SELECT id FROM influencers WHERE handle = '@riyaglows'`)!.id;
  const rec = pkgOf(createExport(db, founder, { type: 'creator_profile', ids: [riya] })).records.influencers[0];
  for (const k of ['conflicts', 'exclusivity_restrictions', 'audience', 'availability_notes', 'unsuitable_categories', 'relationship']) assert.ok(!(k in rec), `${k} left out`);
  assert.equal(rec.platforms[0].username, 'riyaglows');
});

test('one new creator returned twice in a result is created once', () => {
  const key = createExport(db, founder, { type: 'creator_profile', links: ['https://www.instagram.com/twinfoodie/', 'https://www.youtube.com/@twinfoodie'] });
  const base = { name: 'Twin Foodie', handle: '@twinfoodie', recent_content: [] };
  const pv = previewImport(db, founder, JSON.stringify(result(key, [
    profile({ ...base, link: 'https://www.instagram.com/twinfoodie/', platforms: [{ platform: 'instagram', username: 'twinfoodie', profile_url: 'https://www.instagram.com/twinfoodie/', followers: 5000, posts_count: null }] }),
    profile({ ...base, link: 'https://www.youtube.com/@twinfoodie', platforms: [{ platform: 'youtube', username: 'twinfoodie', profile_url: 'https://www.youtube.com/@twinfoodie', followers: 900, posts_count: null }] }),
  ])));
  assert.match(pv.profiles[1].problem, /Same creator as profile #1/);
  assert.throws(() => applyImport(db, founder, pv.import_id, { profiles: [{ index: 0 }, { index: 1, create_new: true }] }), /may already be Twin Foodie/);
  applyImport(db, founder, pv.import_id, { profiles: [{ index: 0 }] });
  assert.equal(get(db, `SELECT COUNT(*) n FROM influencers WHERE handle = '@twinfoodie' AND archived_at IS NULL`)!.n, 1);
});

test('a record reference whose channels disagree is never trusted', () => {
  const riya = get(db, `SELECT * FROM influencers WHERE handle = '@riyaglows'`)!;
  const key = createExport(db, founder, { type: 'creator_profile', ids: [riya.id], links: ['https://www.instagram.com/mixupfoodie/'] });
  const pv = previewImport(db, founder, JSON.stringify(result(key, [profile({
    record: `influencers:${riya.id}`, link: 'https://www.instagram.com/mixupfoodie/', name: 'Mixup Foodie', handle: '@mixupfoodie', recent_content: [],
    platforms: [{ platform: 'instagram', username: 'mixupfoodie', profile_url: 'https://www.instagram.com/mixupfoodie/', followers: 1000, posts_count: null }],
  })])));
  const pr = pv.profiles[0];
  assert.equal(pr.resolved, null);
  assert.match(pr.problem, /Riya Sharma's instagram is @riyaglows/);
  assert.throws(() => applyImport(db, founder, pv.import_id, { profiles: [{ index: 0 }] }), /confirm a new creator/);
  const out = applyImport(db, founder, pv.import_id, { profiles: [{ index: 0, create_new: true }] });
  assert.equal(get(db, 'SELECT name FROM influencers WHERE id = ?', riya.id)!.name, 'Riya Sharma', 'existing creator untouched');
  assert.ok(out.applied.some((a: Row) => a.kind === 'create'));
});

test('channels and posts: off-site links dropped, bad dates skipped, share links de-duplicated, metrics merged, second channel kept', () => {
  const kabir = get(db, `SELECT * FROM influencers WHERE handle = '@kabircooks'`)!;
  const pid = insert(db, 'posts', { influencer_id: kabir.id, platform: 'instagram', external_id: '1789', permalink: 'https://www.instagram.com/reel/KbX1/', published_at: '2026-10-01T10:00:00.000Z', promotion: 'unknown', metrics: { views: 1000, reach: 900, likes: 50, comments: 5, shares: 3, saves: 2 } });
  const key = createExport(db, founder, { type: 'creator_profile', ids: [kabir.id] });
  const item = (url: string, published_at: string, views: number) => ({ platform: 'instagram', url, published_at, format: 'reel', topic: null, duration_sec: null, promotion: 'unknown', views, likes: null, comments: null });
  const pv = previewImport(db, founder, JSON.stringify(result(key, [profile({
    record: `influencers:${kabir.id}`, link: 'https://www.instagram.com/kabircooks/', name: 'Kabir Mehta', handle: '@kabircooks', city: 'Delhi', inferred_fields: [],
    platforms: [
      { platform: 'instagram', username: 'kabircooks', profile_url: 'https://www.instagram.com/kabircooks/', followers: 215000, posts_count: null },
      { platform: 'youtube', username: 'kabircookslive', profile_url: 'https://evil.example/@kabircookslive', followers: 4000, posts_count: null },
    ],
    recent_content: [item('https://instagram.com/reel/KbX1?igsh=abc', '2026-10-01T10:00:00Z', 5000), item('https://evil.example/reel/x', '2026-10-02T10:00:00Z', 1), item('https://www.instagram.com/reel/KbBad/', '2026-10-32T10:00:00Z', 1), item('https://www.instagram.com/reel/KbNew/', '2026-10-05T10:00:00Z', 7000)],
  })])));
  const pr = pv.profiles[0];
  assert.match(pr.problem, /Kabir Mehta's youtube is @kabircooks/, 'an unknown second channel needs confirming');
  assert.ok(pr.issues.some((x: string) => /not on youtube's site/.test(x)));
  assert.deepEqual(pr.content.map((c: Row) => c.usable), [true, false, false, true]);
  assert.match(pr.content[1].skipped, /not on instagram's site/);
  assert.equal(pr.content[2].skipped, 'date is not valid');
  assert.equal(pr.content[0].url, 'https://instagram.com/reel/KbX1', 'tracking parameters dropped');
  applyImport(db, founder, pv.import_id, { profiles: [{ index: 0, resolve_ref: `influencers:${kabir.id}`, fields: [], posts: false, replace_posts: true }] });
  assert.deepEqual(JSON.parse(get(db, 'SELECT metrics FROM posts WHERE id = ?', pid)!.metrics), { views: 5000, reach: 900, likes: 50, comments: 5, shares: 3, saves: 2 }, 'views updated, other figures kept');
  assert.equal(get(db, `SELECT COUNT(*) n FROM posts WHERE influencer_id = ? AND (permalink LIKE '%KbX1%' OR permalink LIKE '%KbNew%')`, kabir.id)!.n, 1, 'no duplicate post; new posts not saved when unticked');
  const yts = JSON.parse(get(db, 'SELECT platforms FROM influencers WHERE id = ?', kabir.id)!.platforms).filter((p: Row) => p.platform === 'youtube');
  assert.deepEqual(yts.map((p: Row) => [p.handle, p.followers, p.url ?? null]), [['@kabircooks', 85000, 'https://www.youtube.com/@kabircooks'], ['@kabircookslive', 4000, null]]);
});

test('a creator changed since the export needs acknowledging; undo keeps a created creator edited afterwards', () => {
  const arjun = get(db, `SELECT * FROM influencers WHERE handle = '@techwitharjun'`)!;
  const key = createExport(db, founder, { type: 'creator_profile', ids: [arjun.id], links: ['https://www.instagram.com/keepme/'] });
  update(db, 'influencers', arjun.id, { city: 'Thiruvananthapuram' });
  const pv = previewImport(db, founder, JSON.stringify(result(key, [
    profile({ record: `influencers:${arjun.id}`, link: 'https://www.youtube.com/@techwitharjun', name: 'Arjun Nair', handle: '@techwitharjun', city: 'Kochi', recent_content: [], platforms: [{ platform: 'youtube', username: 'techwitharjun', profile_url: 'https://www.youtube.com/@techwitharjun', followers: 350000, posts_count: null }] }),
    profile({ link: 'https://www.instagram.com/keepme/', name: 'Keep Me', handle: '@keepme', recent_content: [], platforms: [{ platform: 'instagram', username: 'keepme', profile_url: 'https://www.instagram.com/keepme/', followers: 100, posts_count: null }] }),
  ])));
  assert.equal(pv.profiles[0].stale, true);
  assert.throws(() => applyImport(db, founder, pv.import_id, { profiles: [{ index: 0 }] }), /changed after the export/);
  const out = applyImport(db, founder, pv.import_id, { profiles: [{ index: 0, acknowledge_stale: true, fields: [] }, { index: 1 }] });
  assert.equal(get(db, 'SELECT city FROM influencers WHERE id = ?', arjun.id)!.city, 'Thiruvananthapuram', "the teammate's edit is kept when the field is not ticked");
  const created = out.applied.find((a: Row) => a.kind === 'create')!.id;
  update(db, 'influencers', created, { relationship: 'exclusive' });
  const { skipped } = undoImport(db, founder, pv.import_id, 'test');
  assert.ok(skipped.some((x: string) => x.includes(`influencers #${created} was edited`)), skipped.join('; '));
  assert.equal(get(db, 'SELECT archived_at FROM influencers WHERE id = ?', created)!.archived_at, null);
});

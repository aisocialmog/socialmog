import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get, insert, openDb, type Row, type User } from '../src/server/db.ts';
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
  assert.deepEqual(pr.avg_after.instagram, { avg: 55000, posts: 4 }, 'paid post left out');
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

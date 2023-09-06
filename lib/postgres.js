'use strict';

const winston = require.main.require('winston');
const nconf = require.main.require('nconf');

const db = require.main.require('./src/database');
const pubsub = require.main.require('./src/pubsub');

let searchLanguage = 'english';

pubsub.on('dbsearch-language-changed', (e) => {
	searchLanguage = e.data;
});

async function initDB() {
	await db.pool.query('CREATE TABLE IF NOT EXISTS "searchtopic" ( "id" BIGINT NOT NULL PRIMARY KEY, "content" TEXT, "uid" BIGINT, "cid" BIGINT )');
	await db.pool.query(`CREATE INDEX IF NOT EXISTS "idx__searchtopic__content" ON "searchtopic" USING GIN (to_tsvector('${searchLanguage}', "content"))`);
	await db.pool.query('CREATE INDEX IF NOT EXISTS "idx__searchtopic__uid" ON "searchtopic"("uid")');
	await db.pool.query('CREATE INDEX IF NOT EXISTS "idx__searchtopic__cid" ON "searchtopic"("cid")');

	await db.pool.query('CREATE TABLE IF NOT EXISTS "searchpost" ( "id" BIGINT NOT NULL PRIMARY KEY, "content" TEXT, "uid" BIGINT, "cid" BIGINT )');
	await db.pool.query(`CREATE INDEX IF NOT EXISTS "idx__searchpost__content" ON "searchpost" USING GIN (to_tsvector('${searchLanguage}', "content"))`);
	await db.pool.query('CREATE INDEX IF NOT EXISTS "idx__searchpost__uid" ON "searchpost"("uid")');
	await db.pool.query('CREATE INDEX IF NOT EXISTS "idx__searchpost__cid" ON "searchpost"("cid")');

	await db.pool.query('CREATE TABLE IF NOT EXISTS "searchchat" ( "id" BIGINT NOT NULL PRIMARY KEY, "content" TEXT, "rid" BIGINT, "uid" BIGINT )');
	await db.pool.query(`CREATE INDEX IF NOT EXISTS "idx__searchchat__content" ON "searchchat" USING GIN (to_tsvector('${searchLanguage}', "content"))`);
	await db.pool.query('CREATE INDEX IF NOT EXISTS "idx__searchchat__rid" ON "searchchat"("rid")');
	await db.pool.query('CREATE INDEX IF NOT EXISTS "idx__searchchat__uid" ON "searchchat"("uid")');
}

async function handleError(err) {
	if (err && err.code === '42P01') {
		winston.warn('dbsearch was not initialized');
		await initDB();
		return;
	}

	throw err;
}

exports.createIndices = async function (language) {
	searchLanguage = language;
	if (nconf.get('isPrimary') && !nconf.get('jobsDisabled')) {
		await initDB();
	}
};

exports.changeIndexLanguage = async function (language) {
	searchLanguage = language;
	pubsub.publish('dbsearch-language-changed', language);
	await db.pool.query('DROP INDEX "idx__searchtopic__content"');
	await db.pool.query(`CREATE INDEX "idx__searchtopic__content" ON "searchtopic" USING GIN (to_tsvector('${language}', "content"))`);

	await db.pool.query('DROP INDEX "idx__searchpost__content"');
	await db.pool.query(`CREATE INDEX "idx__searchpost__content" ON "searchpost" USING GIN (to_tsvector('${language}', "content"))`);

	await db.pool.query('DROP INDEX "idx__searchchat__content"');
	await db.pool.query(`CREATE INDEX "idx__searchchat__content" ON "searchchat" USING GIN (to_tsvector('${language}', "content"))`);
};

exports.searchIndex = async function (key, data, ids) {
	if (!ids.length) {
		return;
	}

	ids = ids.map(id => parseInt(id, 10));
	try {
		await db.pool.query({
			name: `dbsearch-searchIndex-${key}`,
			text: `INSERT INTO "search${key}" SELECT d."id", d."data"->>'content' "content", (d."data"->>'uid')::bigint "uid", (d."data"->>'cid')::bigint "cid" FROM UNNEST($1::bigint[], $2::jsonb[]) d("id", "data") ON CONFLICT ("id") DO UPDATE SET "content" = COALESCE(EXCLUDED."content", "search${key}"."content"), "uid" = COALESCE(EXCLUDED."uid", "search${key}"."uid"), "cid" = COALESCE(EXCLUDED."cid", "search${key}"."cid")`,
			values: [ids, data],
		});
	} catch (err) {
		winston.error(`Error indexing ${err.stack}`);
		await handleError(err);
		await exports.searchIndex(key, data, ids);
	}
};

exports.search = async function (key, data, limit) {
	if (Array.isArray(data.uid) && data.uid.filter(Boolean).length) {
		data.uid = data.uid.filter(Boolean);
	} else {
		data.uid = null;
	}

	if (Array.isArray(data.cid) && data.cid.filter(Boolean).length) {
		data.cid = data.cid.filter(Boolean);
	} else {
		data.cid = null;
	}
	try {
		const res = await db.pool.query({
			name: `dbsearch-search-${key}`,
			text: `SELECT ARRAY(SELECT s."id" FROM "search${key}" s WHERE ($1::text IS NULL OR to_tsvector($5::regconfig, "content") @@ plainto_tsquery($5::regconfig, $1::text)) AND ($2::bigint[] IS NULL OR "uid" = ANY($2::bigint[])) AND ($3::bigint[] IS NULL OR "cid" = ANY($3::bigint[])) ORDER BY ts_rank_cd(to_tsvector($5::regconfig, "content"), plainto_tsquery($5::regconfig, $1::text)) DESC, s."id" ASC LIMIT $4::integer) r`,
			values: [data.content, data.uid, data.cid, parseInt(limit, 10), searchLanguage],
		});
		return res.rows[0].r;
	} catch (err) {
		await handleError(err);
		return [];
	}
};

exports.searchRemove = async function (key, ids) {
	if (!key || !ids.length) {
		return;
	}

	ids = ids.map(id => parseInt(id, 10));
	try {
		await db.pool.query({
			name: `dbsearch-searchRemove-${key}`,
			text: `DELETE FROM "search${key}" s WHERE s."id" = ANY($1::bigint[])`,
			values: [ids],
		});
	} catch (err) {
		await handleError(err);
	}
};

exports.chat = {};
exports.chat.index = async (data, ids) => {
	if (!ids.length) {
		return;
	}

	ids = ids.map(id => parseInt(id, 10));
	try {
		await db.pool.query({
			name: `dbsearch-searchIndex-chat`,
			text: `INSERT INTO "searchchat" SELECT d."id", d."data"->>'content' "content", (d."data"->>'uid')::bigint "uid", (d."data"->>'roomId')::bigint "rid" FROM UNNEST($1::bigint[], $2::jsonb[]) d("id", "data") ON CONFLICT ("id") DO UPDATE SET "content" = COALESCE(EXCLUDED."content", "searchchat"."content"), "uid" = COALESCE(EXCLUDED."uid", "searchchat"."uid"), "rid" = COALESCE(EXCLUDED."rid", "searchchat"."rid")`,
			values: [ids, data],
		});
	} catch (err) {
		winston.error(`Error indexing ${err.stack}`);
		await handleError(err);
		await exports.chat.index(data, ids);
	}
};

exports.chat.search = async (data, limit) => {
	if (Array.isArray(data.uid) && data.uid.filter(Boolean).length) {
		data.uid = data.uid.filter(Boolean);
	} else {
		data.uid = null;
	}

	if (Array.isArray(data.roomId) && data.roomId.filter(Boolean).length) {
		data.roomId = data.roomId.filter(Boolean);
	} else {
		data.roomId = null;
	}
	try {
		const res = await db.pool.query({
			name: `dbsearch-search-chat`,
			text: `SELECT ARRAY(SELECT s."id" FROM "searchchat" s WHERE ($1::text IS NULL OR to_tsvector($5::regconfig, "content") @@ plainto_tsquery($5::regconfig, $1::text)) AND ($2::bigint[] IS NULL OR "uid" = ANY($2::bigint[])) AND ($3::bigint[] IS NULL OR "rid" = ANY($3::bigint[])) ORDER BY ts_rank_cd(to_tsvector($5::regconfig, "content"), plainto_tsquery($5::regconfig, $1::text)) DESC, s."id" ASC LIMIT $4::integer) r`,
			values: [data.content, data.uid, data.roomId, parseInt(limit, 10), searchLanguage],
		});
		return res.rows[0].r;
	} catch (err) {
		await handleError(err);
		return [];
	}
};

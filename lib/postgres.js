'use strict';

var winston = require.main.require('winston');
var async = require.main.require('async');
var nconf = require.main.require('nconf');
var nbbRequire = require('./nbbRequire');

var db = nbbRequire('src/database');

exports.createIndices = function (callback) {
	callback = callback || function () {};
	if (nconf.get('isPrimary') === 'true' && !nconf.get('jobsDisabled')) {
		async.series([
			function(next) {
				db.pool.query('CREATE TABLE IF NOT EXISTS "searchtopic" ( "id" BIGINT NOT NULL PRIMARY KEY, "content" TEXT, "uid" BIGINT, "cid" BIGINT )', next);
			},
			function(next) {
				db.pool.query('CREATE INDEX IF NOT EXISTS "idx__searchtopic__content" ON "searchtopic" USING GIN (to_tsvector(\'english\', "content"))', next);
			},
			function(next) {
				db.pool.query('CREATE INDEX IF NOT EXISTS "idx__searchtopic__uid" ON "searchtopic"("uid")', next);
			},
			function(next) {
				db.pool.query('CREATE INDEX IF NOT EXISTS "idx__searchtopic__cid" ON "searchtopic"("cid")', next);
			},
			function(next) {
				db.pool.query('CREATE TABLE IF NOT EXISTS "searchpost" ( "id" BIGINT NOT NULL PRIMARY KEY, "content" TEXT, "uid" BIGINT, "cid" BIGINT )', next);
			},
			function(next) {
				db.pool.query('CREATE INDEX IF NOT EXISTS "idx__searchpost__content" ON "searchpost" USING GIN (to_tsvector(\'english\', "content"))', next);
			},
			function(next) {
				db.pool.query('CREATE INDEX IF NOT EXISTS "idx__searchpost__uid" ON "searchpost"("uid")', next);
			},
			function(next) {
				db.pool.query('CREATE INDEX IF NOT EXISTS "idx__searchpost__cid" ON "searchpost"("cid")', next);
			}
		], function(err) {
			if (err) {
				winston.error(err);
			}
			callback(err);
		});
	}
};

exports.searchIndex = function(key, data, ids, callback) {
	callback = callback || function() {};

	if (!ids.length) {
		return callback();
	}

	ids = ids.map(function(id) {
		return parseInt(id, 10);
	});

	db.pool.query({
		name: 'dbsearch-searchIndex-' + key,
		text: 'INSERT INTO "search' + key + '" SELECT d."id", d."data"->>\'content\' "content", (d."data"->>\'uid\')::bigint "uid", (d."data"->>\'cid\')::bigint "cid" FROM UNNEST($1::bigint[], $2::jsonb[]) d("id", "data") ON CONFLICT ("id") DO UPDATE SET "content" = COALESCE(EXCLUDED."content", "search' + key + '"."content"), "uid" = COALESCE(EXCLUDED."uid", "search' + key + '"."uid"), "cid" = COALESCE(EXCLUDED."cid", "search' + key + '"."cid")',
		values: [ids, data]
	}, function(err) {
		if (err) {
			winston.error('Error indexing ' + err.message);
		}
		callback(err);
	});
};

exports.search = function(key, data, limit, callback) {
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

	db.pool.query({
		name: 'dbsearch-search-' + key,
		text: 'SELECT ARRAY(SELECT s."id" FROM "search' + key + '" s WHERE ($1::text IS NULL OR to_tsvector(\'english\', "content") @@ plainto_tsquery(\'english\', $1::text)) AND ($2::bigint[] IS NULL OR "uid" = ANY($2::bigint[])) AND ($3::bigint[] IS NULL OR "cid" = ANY($3::bigint[])) ORDER BY ts_rank_cd(to_tsvector(\'english\', "content"), plainto_tsquery(\'english\', $1::text)) DESC, s."id" ASC LIMIT $4::integer) r',
		values: [data.content, data.uid, data.cid, parseInt(limit, 10)]
	}, function(err, res) {
		if (err) {
			return callback(err);
		}
		callback(null, res.rows[0].r);
	});
};

exports.searchRemove = function(key, ids, callback) {
	callback = callback || function() {};

	if (!ids.length) {
		return callback();
	}

	ids = ids.map(function(id) {
		return parseInt(id, 10);
	});

	db.pool.query({
		name: 'dbsearch-searchRemove-' + key,
		text: 'DELETE FROM "search' + key + '" s WHERE s."id" = ANY($1::bigint[])',
		values: [ids]
	}, function(err) {
		callback(err);
	});
};

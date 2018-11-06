'use strict';

var winston = require.main.require('winston');
var async = require.main.require('async');
var nconf = require.main.require('nconf');


var db = require.main.require('./src/database');
var pubsub = require.main.require('./src/pubsub');

var searchLanguage = 'english';

pubsub.on('dbsearch-language-changed', function(e) {
	searchLanguage = e.data;
});

function initDB(callback) {
	async.series([
		function(next) {
			db.pool.query('CREATE TABLE IF NOT EXISTS "searchtopic" ( "id" BIGINT NOT NULL PRIMARY KEY, "content" TEXT, "uid" BIGINT, "cid" BIGINT )', next);
		},
		function(next) {
			db.pool.query('CREATE INDEX IF NOT EXISTS "idx__searchtopic__content" ON "searchtopic" USING GIN (to_tsvector(\'' + searchLanguage + '\', "content"))', next);
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
			db.pool.query('CREATE INDEX IF NOT EXISTS "idx__searchpost__content" ON "searchpost" USING GIN (to_tsvector(\'' + searchLanguage + '\', "content"))', next);
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

function handleError(err, callback, retry) {
	if (err && err.code === '42P01') {
		winston.warn('dbsearch was not initialized');
		return initDB(function(err) {
			if (err) {
				return callback(err);
			}
			retry();
		});
	}

	callback(err);
}

exports.createIndices = function(language, callback) {
	callback = callback || function () {};
	searchLanguage = language;
	if (nconf.get('isPrimary') === 'true' && !nconf.get('jobsDisabled')) {
		initDB(callback);
	} else {
		callback();
	}
};

exports.changeIndexLanguge = function(language, callback) {
	callback = callback || function () {};
	searchLanguage = language;
	pubsub.publish('dbsearch-language-changed', language);
	async.series([
		function(next) {
			db.pool.query('DROP INDEX "idx__searchtopic__content"', next);
		},
		function(next) {
			db.pool.query('CREATE INDEX "idx__searchtopic__content" ON "searchtopic" USING GIN (to_tsvector(\'' + language + '\', "content"))', next);
		},
		function(next) {
			db.pool.query('DROP INDEX "idx__searchpost__content"', next);
		},
		function(next) {
			db.pool.query('CREATE INDEX "idx__searchpost__content" ON "searchpost" USING GIN (to_tsvector(\'' + language + '\', "content"))', next);
		}
	], function(err) {
		if (err) {
			winston.error(err);
		}
		callback(err);
	});
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
		handleError(err, callback, function() {
			exports.searchIndex(key, data, ids, callback);
		});
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
		text: 'SELECT ARRAY(SELECT s."id" FROM "search' + key + '" s WHERE ($1::text IS NULL OR to_tsvector($5::regconfig, "content") @@ plainto_tsquery($5::regconfig, $1::text)) AND ($2::bigint[] IS NULL OR "uid" = ANY($2::bigint[])) AND ($3::bigint[] IS NULL OR "cid" = ANY($3::bigint[])) ORDER BY ts_rank_cd(to_tsvector($5::regconfig, "content"), plainto_tsquery($5::regconfig, $1::text)) DESC, s."id" ASC LIMIT $4::integer) r',
		values: [data.content, data.uid, data.cid, parseInt(limit, 10), searchLanguage]
	}, function(err, res) {
		if (err) {
			return handleError(err, callback, function() {
				callback(null, []);
			});
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
		handleError(err, callback, callback);
	});
};

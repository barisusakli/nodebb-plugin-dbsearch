'use strict';

const winston = require.main.require('winston');
const nconf = require.main.require('nconf');

const database = require.main.require('./src/database');
const pubsub = require.main.require('./src/pubsub');

async function initDB() {
  const { db } = database;
  db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS "searchtopic" USING fts5(
    "content", 
    "uid" UNINDEXED,
    "cid" UNINDEXED)`);
  db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS "searchpost" USING fts5(
    "content", 
    "uid" UNINDEXED,
    "cid" UNINDEXED)`);
}

async function handleError(err) {
	if (err && /no such table/i.test(err.message)) {
		winston.warn('dbsearch was not initialized');
		await initDB();
		return;
	}
	throw err;
}

exports.createIndices = async function (language) {
	if (nconf.get('isPrimary') && !nconf.get('jobsDisabled')) {
		await initDB();
	}
};

exports.changeIndexLanguage = async function (language) {
	pubsub.publish('dbsearch-language-changed', language);
};

exports.searchIndex = async function (key, data, ids) {
  const { db } = database;
	if (!ids.length) {
		return;
	}

	ids = ids.map(id => parseInt(id, 10));
	try {
    const upsert = db.prepare(`
    REPLACE INTO "search${key}" ("rowid", "content", "uid", "cid")      
    VALUES (@id, @content, @uid, @cid)`);
    for (const [ i, id ] of ids.entries()) {
      const { content, uid, cid } = data[i];
      upsert.run({ id, content, uid, cid });
    }
	} catch (err) {
		winston.error(`Error indexing ${err.stack}`);
		await handleError(err);
    await exports.searchIndex(key, data, ids);
	}
};

exports.search = async function (key, data, limit) {
  const { db } = database;
  const { content, matchWords, uid, cid } = data;
  if (!content) {
    return [];
  }
  const query = parseQuery(content, matchWords);
  const [ params, uidList ] = listParams({ query, limit }, uid, 'uid');
  const [ , cidList ] = listParams(params, cid, 'cid');
  const conditions = [ `"content" MATCH @query` ];
  if (uidList.length > 0) {
    conditions.push(`uid IN (${uidList})`);
  }
  if (cidList.length > 0) {
    conditions.push(`cid IN (${cidList})`);
  }
  try {    
    const rows = db.prepare(`
    SELECT rowid FROM "search${key}" 
    WHERE ${conditions.join(' AND ')}
    LIMIT @limit`).all(params);
		return rows.map(r => r.rowid);
	} catch (err) {
    await handleError(err);
		return [];
	}
};

exports.searchRemove = async function (key, ids) {
  const { db } = database;
	if (!key || !ids.length) {
		return;
	}
  const [ params, idList ] = listParams({}, ids);
	try {
    db.prepare(`
    DELETE FROM "search${key}"
    WHERE "rowid" IN (${idList})`).run(params);
	} catch (err) {
		await handleError(err);
	}
};

function listParams(params, keys, prefix) {
	const keyList = [];
  if (Array.isArray(keys)) {
    for (const [ i, k ] of keys.entries()) {
      const name = prefix + i;
      params[name] = parseInt(k);
      keyList.push(`@${name}`);
    }
  }
	return [params, keyList];
}

function parseQuery(content, matchWords) {
  const words = content.trim().split(/\s+/);
  const sep = (matchWords === 'any') ? ' OR ' : ' ';
  return words.join(sep);
}

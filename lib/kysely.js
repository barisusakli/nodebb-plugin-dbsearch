'use strict';

const winston = require.main.require('winston');
const nconf = require.main.require('nconf');

const db = require.main.require('./src/database');
const pubsub = require.main.require('./src/pubsub');

let searchLanguage = 'english';

pubsub.on('dbsearch-language-changed', (e) => {
	searchLanguage = e.data;
});

/**
 * Initialize database tables using Kysely schema builder
 */
async function initDB() {
	// Create searchtopic table
	await db.db.schema
		.createTable('searchtopic')
		.ifNotExists()
		.addColumn('id', 'varchar(255)', col => col.primaryKey().notNull())
		.addColumn('content', 'text')
		.addColumn('uid', 'varchar(255)')
		.addColumn('cid', 'varchar(255)')
		.execute();

	await db.db.schema
		.createIndex('idx__searchtopic__uid')
		.ifNotExists()
		.on('searchtopic')
		.column('uid')
		.execute()
		.catch(() => {});

	await db.db.schema
		.createIndex('idx__searchtopic__cid')
		.ifNotExists()
		.on('searchtopic')
		.column('cid')
		.execute()
		.catch(() => {});

	// Create searchpost table
	await db.db.schema
		.createTable('searchpost')
		.ifNotExists()
		.addColumn('id', 'varchar(255)', col => col.primaryKey().notNull())
		.addColumn('content', 'text')
		.addColumn('uid', 'varchar(255)')
		.addColumn('cid', 'varchar(255)')
		.execute();

	await db.db.schema
		.createIndex('idx__searchpost__uid')
		.ifNotExists()
		.on('searchpost')
		.column('uid')
		.execute()
		.catch(() => {});

	await db.db.schema
		.createIndex('idx__searchpost__cid')
		.ifNotExists()
		.on('searchpost')
		.column('cid')
		.execute()
		.catch(() => {});

	// Create searchchat table
	await db.db.schema
		.createTable('searchchat')
		.ifNotExists()
		.addColumn('id', 'varchar(255)', col => col.primaryKey().notNull())
		.addColumn('content', 'text')
		.addColumn('rid', 'bigint')
		.addColumn('uid', 'varchar(255)')
		.execute();

	await db.db.schema
		.createIndex('idx__searchchat__rid')
		.ifNotExists()
		.on('searchchat')
		.column('rid')
		.execute()
		.catch(() => {});

	await db.db.schema
		.createIndex('idx__searchchat__uid')
		.ifNotExists()
		.on('searchchat')
		.column('uid')
		.execute()
		.catch(() => {});
}

/**
 * Handle errors - reinitialize if table doesn't exist
 */
async function handleError(err) {
	const errMsg = err?.message || '';
	const errCode = err?.code || '';

	// Check for table not found errors across different databases
	if (
		errCode === '42P01' || // PostgreSQL: undefined table
		errCode === 'ER_NO_SUCH_TABLE' || // MySQL
		err?.errno === 1146 || // MySQL
		errMsg.includes('no such table') || // SQLite
		errMsg.includes('does not exist') // Generic
	) {
		winston.warn('dbsearch was not initialized');
		await initDB();
		return;
	}

	throw err;
}

/**
 * Check if the database uses ON DUPLICATE KEY UPDATE (MySQL) or ON CONFLICT (PostgreSQL/SQLite)
 */
function usesOnDuplicateKey() {
	const features = db.features || db.context?.features;
	if (features?.onDuplicateKey) {
		return true;
	}
	const dialect = db.dialect || db.context?.dialect;
	return dialect === 'mysql';
}

exports.createIndices = async function (language) {
	searchLanguage = language;

	if (nconf.get('isPrimary') && !nconf.get('jobsDisabled')) {
		await initDB();
	}
};

exports.changeIndexLanguage = async function (language) {
	searchLanguage = language;
	pubsub.publish('dbsearch-language-changed', searchLanguage);
	// Generic SQL doesn't support language-specific indexes
	// This would need to be extended for full-text search
};

exports.searchIndex = async function (key, data, ids) {
	if (!ids.length) {
		return;
	}

	ids = ids.map(String);
	const tableName = `search${key}`;
	const useOnDuplicateKey = usesOnDuplicateKey();

	try {
		for (let i = 0; i < ids.length; i++) {
			const id = ids[i];
			const item = data[i];
			const content = item.content || null;
			const uid = item.uid ? String(item.uid) : null;
			const cid = item.cid ? String(item.cid) : null;

			if (useOnDuplicateKey) {
				// MySQL uses ON DUPLICATE KEY UPDATE
				await db.db
					.insertInto(tableName)
					.values({ id, content, uid, cid })
					.onDuplicateKeyUpdate({
						content: eb => eb.fn('COALESCE', [eb.val(content), eb.ref('content')]),
						uid: eb => eb.fn('COALESCE', [eb.val(uid), eb.ref('uid')]),
						cid: eb => eb.fn('COALESCE', [eb.val(cid), eb.ref('cid')]),
					})
					.execute();
			} else {
				// PostgreSQL and SQLite use ON CONFLICT
				await db.db
					.insertInto(tableName)
					.values({ id, content, uid, cid })
					.onConflict(oc => oc
						.column('id')
						.doUpdateSet({
							content: eb => eb.fn('COALESCE', [eb.ref('excluded.content'), eb.ref(`${tableName}.content`)]),
							uid: eb => eb.fn('COALESCE', [eb.ref('excluded.uid'), eb.ref(`${tableName}.uid`)]),
							cid: eb => eb.fn('COALESCE', [eb.ref('excluded.cid'), eb.ref(`${tableName}.cid`)]),
						}))
					.execute();
			}
		}
	} catch (err) {
		winston.error(`Error indexing ${err.stack}`);
		await handleError(err);
		await exports.searchIndex(key, data, ids);
	}
};

exports.search = async function (key, data, limit) {
	// Normalize uid and cid arrays
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
		const tableName = `search${key}`;
		const {content} = data;
		const {uid} = data;
		const {cid} = data;
		const limitNum = parseInt(limit, 10);

		let query = db.db
			.selectFrom(tableName)
			.select('id');

		// Use simple LIKE for content search (works on all SQL databases)
		if (content) {
			const searchPattern = `%${content}%`;
			query = query.where('content', 'like', searchPattern);
		}

		if (uid && uid.length) {
			query = query.where('uid', 'in', uid.map(String));
		}

		if (cid && cid.length) {
			query = query.where('cid', 'in', cid.map(String));
		}

		query = query.orderBy('id', 'asc').limit(limitNum);

		const results = await query.execute();
		return results.map(row => row.id);
	} catch (err) {
		await handleError(err);
		return [];
	}
};

exports.searchRemove = async function (key, ids) {
	if (!key || !ids.length) {
		return;
	}

	ids = ids.map(String);
	const tableName = `search${key}`;

	try {
		await db.db
			.deleteFrom(tableName)
			.where('id', 'in', ids)
			.execute();
	} catch (err) {
		await handleError(err);
	}
};

exports.chat = {};

exports.chat.index = async (data, ids) => {
	if (!ids.length) {
		return;
	}

	ids = ids.map(String);
	const useOnDuplicateKey = usesOnDuplicateKey();

	try {
		for (let i = 0; i < ids.length; i++) {
			const id = ids[i];
			const item = data[i];
			const content = item.content || null;
			const rid = item.roomId ? parseInt(item.roomId, 10) : null;
			const uid = item.uid ? String(item.uid) : null;

			if (useOnDuplicateKey) {
				await db.db
					.insertInto('searchchat')
					.values({ id, content, rid, uid })
					.onDuplicateKeyUpdate({
						content: eb => eb.fn('COALESCE', [eb.val(content), eb.ref('content')]),
						uid: eb => eb.fn('COALESCE', [eb.val(uid), eb.ref('uid')]),
						rid: eb => eb.fn('COALESCE', [eb.val(rid), eb.ref('rid')]),
					})
					.execute();
			} else {
				await db.db
					.insertInto('searchchat')
					.values({ id, content, rid, uid })
					.onConflict(oc => oc
						.column('id')
						.doUpdateSet({
							content: eb => eb.fn('COALESCE', [eb.ref('excluded.content'), eb.ref('searchchat.content')]),
							uid: eb => eb.fn('COALESCE', [eb.ref('excluded.uid'), eb.ref('searchchat.uid')]),
							rid: eb => eb.fn('COALESCE', [eb.ref('excluded.rid'), eb.ref('searchchat.rid')]),
						}))
					.execute();
			}
		}
	} catch (err) {
		winston.error(`Error indexing chat ${err.stack}`);
		await handleError(err);
		await exports.chat.index(data, ids);
	}
};

exports.chat.search = async (data, limit) => {
	// Normalize uid and roomId arrays
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
		const {content, uid, roomId} = data;
		const limitNum = parseInt(limit, 10);

		let query = db.db
			.selectFrom('searchchat')
			.select('id');

		// Use simple LIKE for content search
		if (content) {
			const searchPattern = `%${content}%`;
			query = query.where('content', 'like', searchPattern);
		}

		if (uid && uid.length) {
			query = query.where('uid', 'in', uid.map(String));
		}

		if (roomId && roomId.length) {
			query = query.where('rid', 'in', roomId.map(r => parseInt(r, 10)));
		}

		query = query.orderBy('id', 'asc').limit(limitNum);

		const results = await query.execute();
		return results.map(row => row.id);
	} catch (err) {
		await handleError(err);
		return [];
	}
};

exports.getIndexedTopicCount = async () => {
	try {
		const result = await db.db
			.selectFrom('searchtopic')
			.select(eb => eb.fn.countAll().as('count'))
			.executeTakeFirst();
		return result?.count ? parseInt(result.count, 10) : 0;
	} catch (err) {
		return 0;
	}
};

exports.getIndexedPostCount = async () => {
	try {
		const result = await db.db
			.selectFrom('searchpost')
			.select(eb => eb.fn.countAll().as('count'))
			.executeTakeFirst();
		return result?.count ? parseInt(result.count, 10) : 0;
	} catch (err) {
		return 0;
	}
};

exports.getIndexedChatMessageCount = async () => {
	try {
		const result = await db.db
			.selectFrom('searchchat')
			.select(eb => eb.fn.countAll().as('count'))
			.executeTakeFirst();
		return result?.count ? parseInt(result.count, 10) : 0;
	} catch (err) {
		return 0;
	}
};